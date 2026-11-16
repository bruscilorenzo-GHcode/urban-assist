/** VISUALISE the INNER LIVING CANVAS of the RELATIONAL-BEING.
 *
 *  An experimental, additive layer: the relations between stories are drawn
 *  as **living plant filaments** — roots and mycelium — whose thickness is
 *  the information moving along the relation (edge weight), with root hairs,
 *  nodules and a slow flow along the tendril. It never replaces the map; it
 *  sits above it, off by default, and every tendril can be inspected: hovering
 *  shows the server-side template explanation of the relation.
 *
 *  Constraints: no language model, no invented content (labels come from the
 *  state), reduced motion respected (static roots, no particles), and the
 *  drawing degrades honestly when the corpus is small. */

import * as L from 'leaflet'
import { RELATION_TYPES, type FabricConfig, type FabricEdge, type State } from '../core/state/types.js'

export interface Pt { x: number; y: number }

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

/** Thickness of a tendril: information carried by the relation. */
export function filamentWidth(weight: number, maxThickness = 7): number {
  return 1.2 + Math.max(0, maxThickness) * clamp01(weight)
}

/** Deterministic 0..1 from a string (no PRNG, same drawing every frame). */
export function hash01(input: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
    h ^= h >>> 13
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Two control points for an organic cubic tendril between two story nodes. */
export function tendrilControls(from: Pt, to: Pt, seed: string, index: number, curvature = 0.22): { c1: Pt, c2: Pt } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const nx = -dy / length
  const ny = dx / length
  const bend = length * curvature * (0.5 + hash01(seed, index * 17))
  const wobble1 = (hash01(seed, index * 31 + 1) - 0.5) * length * 0.12
  const wobble2 = (hash01(seed, index * 31 + 2) - 0.5) * length * 0.12
  return {
    c1: { x: from.x + dx * 0.33 + nx * bend + wobble1, y: from.y + dy * 0.33 + ny * bend + wobble1 * 0.6 },
    c2: { x: from.x + dx * 0.68 - nx * bend * 0.7 + wobble2, y: from.y + dy * 0.68 - ny * bend * 0.7 + wobble2 * 0.6 },
  }
}

export function sampleCubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number, out?: Pt): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  const x = a * p0.x + b * c1.x + c * c2.x + d * p1.x
  const y = a * p0.y + b * c1.y + c * c2.y + d * p1.y
  if (out) { out.x = x; out.y = y; return out }
  return { x, y }
}

/** Nearest sample to a point (used for tendril inspection). */
export function nearestOnSamples(samples: Pt[], x: number, y: number): { index: number, distance: number } {
  let best = { index: -1, distance: Number.POSITIVE_INFINITY }
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!
    const distance = Math.hypot(sample.x - x, sample.y - y)
    if (distance < best.distance) best = { index: i, distance }
  }
  return best
}

/** Vegetal palette per relation type — roots, moss, humus, sap. */
const ROOT_COLORS: Record<string, string> = {
  proximity: '#3f7f4e',
  place: '#567f38',
  cooccurrence: '#7a8a34',
  topic: '#8a6a2f',
  semantic: '#3d7a6a',
  author_community: '#6a5a3a',
}

function colorFor(type: string): string {
  return ROOT_COLORS[type] ?? '#4f7f45'
}

function toRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  if (value.length !== 6) return `rgba(0,0,0,${alpha})`
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

interface Hover {
  edge: FabricEdge
  x: number
  y: number
}

const SAMPLES = 24

export class LivingCanvas {
  private readonly map: L.Map
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private state: State | null = null
  private config: FabricConfig | null = null
  private hover: Hover | null = null
  private frame: number | null = null
  private destroyed = false
  private loop = 0
  private cache: Array<{ edge: FabricEdge, samples: Pt[] }> = []

  private readonly schedule = () => {
    if (this.destroyed) return
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.draw()
    })
  }

  private readonly animate = () => {
    if (this.destroyed) return
    const now = performance.now()
    if (now - this.loop < 33) {
      this.frame = requestAnimationFrame(this.animate)
      return
    }
    this.loop = now
    this.draw(true)
    this.frame = requestAnimationFrame(this.animate)
  }

  private readonly onMove = (event: L.LeafletMouseEvent) => {
    if (!this.config?.enabled) return
    const x = event.containerPoint.x
    const y = event.containerPoint.y
    let found: Hover | null = null
    let closest = 10
    for (const entry of this.cache) {
      const nearest = nearestOnSamples(entry.samples, x, y)
      const tolerance = 5 + filamentWidth(entry.edge.weight) * 1.6
      if (nearest.distance <= Math.min(tolerance, closest)) {
        closest = nearest.distance
        found = { edge: entry.edge, x, y }
      }
    }
    const changed = (found?.edge.id ?? null) !== (this.hover?.edge.id ?? null)
    this.hover = found
    if (changed) this.schedule()
  }

  private readonly onLeave = () => {
    if (!this.hover) return
    this.hover = null
    this.schedule()
  }

  constructor(map: L.Map) {
    this.map = map
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'au-living-canvas'
    this.canvas.setAttribute('aria-hidden', 'true')
    this.ctx = this.canvas.getContext('2d')
    map.getContainer().appendChild(this.canvas)
    map.on('move zoom zoomend viewreset resize', this.schedule)
    map.on('mousemove', this.onMove)
    map.on('mouseout', this.onLeave)
    this.schedule()
  }

  setState(state: State | null): void {
    this.state = state
    this.schedule()
  }

  setConfig(config: FabricConfig): void {
    const wasEnabled = this.config?.enabled ?? false
    this.config = config
    this.canvas.style.visibility = config.enabled ? 'visible' : 'hidden'
    if (config.enabled && !wasEnabled && !config.reducedMotion) {
      if (this.frame !== null) cancelAnimationFrame(this.frame)
      this.frame = null
      this.frame = requestAnimationFrame(this.animate)
    }
    this.schedule()
  }

  destroy(): void {
    this.destroyed = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.map.off('move zoom zoomend viewreset resize', this.schedule)
    this.map.off('mousemove', this.onMove)
    this.map.off('mouseout', this.onLeave)
    this.canvas.remove()
  }

  private edges(): FabricEdge[] {
    const { state, config } = this
    if (!state || !config) return []
    return state.fabric.edges.filter((edge) => config.relations[edge.type] !== false)
  }

  private draw(animate = false): void {
    const { canvas, ctx, map, config, state } = this
    if (!ctx) return
    const size = map.getSize()
    const dpr = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(size.x * dpr) || canvas.height !== Math.round(size.y * dpr)) {
      canvas.width = Math.round(size.x * dpr)
      canvas.height = Math.round(size.y * dpr)
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)
    if (!config || !state || !config.enabled || config.opacity <= 0) return

    const points = new Map<string, L.Point>()
    for (const node of state.fabric.nodes) {
      if (!node.point) continue
      points.set(node.storyId, map.latLngToContainerPoint(node.point))
    }
    const timeOf = new Map(state.fabric.nodes.map((node) => [node.storyId, node.ts ?? '']))
    const edges = this.edges()
    const phase = performance.now() / 1000
    const animated = animate && !config.reducedMotion
    this.cache = []

    for (const edge of edges) {
      const from = points.get(edge.from)
      const to = points.get(edge.to)
      if (!from || !to) continue
      const color = colorFor(edge.type)
      const context = edge.band === 'context'
      const weight = clamp01(edge.weight)
      const alpha = config.opacity * (context ? 0.20 : 0.82) * (0.32 + 0.68 * weight)
      const width = filamentWidth(weight, 6 * Math.max(0.4, config.thickness))

      // Direction of the sap: older story → newer story when timestamps exist.
      const tFrom = timeOf.get(edge.from) ?? ''
      const tTo = timeOf.get(edge.to) ?? ''
      const reversed = tFrom && tTo ? tFrom > tTo : false
      const p0 = reversed ? to : from
      const p1 = reversed ? from : to

      const typeIndex = Math.max(0, RELATION_TYPES.indexOf(edge.type))
      const controls = tendrilControls({ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }, edge.id, typeIndex, 0.16)

      // Halo: wet living edge.
      ctx.strokeStyle = toRgba(color, alpha * 0.20)
      ctx.lineWidth = width + 3.2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.bezierCurveTo(controls.c1.x, controls.c1.y, controls.c2.x, controls.c2.y, p1.x, p1.y)
      ctx.stroke()

      // The root itself.
      ctx.strokeStyle = toRgba(color, alpha)
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.bezierCurveTo(controls.c1.x, controls.c1.y, controls.c2.x, controls.c2.y, p1.x, p1.y)
      ctx.stroke()

      // Root hairs: short perpendicular growth, thicker relations carry more.
      const samples: Pt[] = []
      const hairCount = context ? 6 : 10
      for (let i = 0; i <= SAMPLES; i += 1) samples.push(sampleCubic(p0, controls.c1, controls.c2, p1, i / SAMPLES))
      ctx.strokeStyle = toRgba(color, alpha * 0.65)
      ctx.lineWidth = Math.max(0.6, width * 0.28)
      for (let hair = 1; hair < hairCount; hair += 1) {
        const t = hair / hairCount
        const at = sampleCubic(p0, controls.c1, controls.c2, p1, t)
        const ahead = sampleCubic(p0, controls.c1, controls.c2, p1, Math.min(1, t + 0.02))
        const dx = ahead.x - at.x
        const dy = ahead.y - at.y
        const length = Math.hypot(dx, dy) || 1
        const nx = -dy / length
        const ny = dx / length
        const hairLength = (2 + 7 * weight) * (0.6 + hash01(edge.id, hair))
        for (const side of [-1, 1]) {
          ctx.beginPath()
          ctx.moveTo(at.x, at.y)
          ctx.lineTo(at.x + nx * hairLength * side + dx * 0.4, at.y + ny * hairLength * side + dy * 0.4)
          ctx.stroke()
        }
      }

      // Nodules at the story roots.
      for (const point of [p0, p1]) {
        const radius = 2 + 3.4 * weight
        ctx.fillStyle = toRgba(color, Math.min(1, alpha + 0.15))
        ctx.beginPath()
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
        ctx.fill()
      }

      // Sap flow: slow particles along the tendril (reduced motion: static).
      if (animated) {
        const glow = edges.length <= 80
        for (let particle = 0; particle < 2; particle += 1) {
          const t = (phase * (0.05 + 0.05 * weight) + (particle + hash01(edge.id, 44)) * 0.5) % 1
          const at = sampleCubic(p0, controls.c1, controls.c2, p1, t)
          ctx.fillStyle = toRgba('#e8f3c8', Math.min(0.9, alpha + 0.25))
          if (glow) { ctx.shadowColor = toRgba(color, 0.9); ctx.shadowBlur = 6 }
          ctx.beginPath()
          ctx.arc(at.x, at.y, 1.5 + 1.5 * weight, 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
        }
      }

      this.cache.push({ edge, samples })
    }

    // Inspection: the template explanation of the hovered relation.
    if (this.hover) {
      const text = this.hover.edge.explanation
      ctx.font = '10.5px "Space Grotesk", ui-sans-serif, system-ui, sans-serif'
      const maxWidth = 280
      const words = text.split(/\s+/)
      const lines: string[] = []
      let line = ''
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (ctx.measureText(candidate).width > maxWidth - 16 && line) {
          lines.push(line)
          line = word
          if (lines.length === 2) break
        } else {
          line = candidate
        }
      }
      if (line && lines.length < 2) lines.push(line)
      const boxWidth = Math.min(maxWidth, Math.max(120, ...lines.map((entry) => ctx.measureText(entry).width)) + 16)
      const boxHeight = 8 + lines.length * 14
      let x = this.hover.x + 12
      let y = this.hover.y - boxHeight - 8
      if (x + boxWidth > size.x - 6) x = size.x - boxWidth - 6
      if (y < 6) y = this.hover.y + 14
      ctx.fillStyle = 'rgba(8, 12, 20, 0.92)'
      ctx.beginPath()
      ctx.roundRect(x, y, boxWidth, boxHeight, 8)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#ece5d6'
      lines.forEach((entry, index) => ctx.fillText(entry, x + 8, y + 14 + index * 14))
    }

    if (config.enabled && !config.reducedMotion && !animate) {
      if (this.frame !== null) cancelAnimationFrame(this.frame)
      this.frame = null
      this.frame = requestAnimationFrame(this.animate)
    }
  }
}
