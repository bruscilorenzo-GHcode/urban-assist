/** EXPERIMENTAL video renderer (limited pilot) — adapted from the
 *  collaborators' "suoni della città" montage engine, bounded and gated.
 *
 *  Purpose of the pilot: verify whether beat-aligned cutting adds something
 *  to our deterministic plan. Limits: ≤15 s, ≤8 clips, one audio bed,
 *  first-come preview, abortable; unsupported browsers fall back to the
 *  storyboard preview. Nothing here is deployed by default (`?exp=render`).
 *
 *  Pure parts (cut snapping, limits, size estimates) are unit-tested; the
 *  MediaRecorder path is only exercised in the browser by the operator. */

import type { MontagePlan } from '../../core/montage/types.js'

export type RenderStyleId = 'calmo' | 'ritmato' | 'energico'
export type RenderGradeId = 'naturale' | 'caldo' | 'freddo' | 'bn'
export type RenderFormat = 'verticale' | 'orizzontale'

export const RENDER_LIMITS = {
  maxDurationSec: 15,
  maxClips: 8,
  /** Keep well below the story budget (50 MB) and above a single request. */
  maxSizeBytes: 20 * 1024 * 1024,
  fps: 30,
} as const

export function renderStyle(id: RenderStyleId): { beatsPerCut: number; dissolve: number; zoom: number; flash: number } {
  switch (id) {
    case 'ritmato': return { beatsPerCut: 2, dissolve: 0.12, zoom: 0.06, flash: 0.15 }
    case 'energico': return { beatsPerCut: 1, dissolve: 0, zoom: 0.08, flash: 0.35 }
    default: return { beatsPerCut: 4, dissolve: 0.45, zoom: 0.04, flash: 0 }
  }
}

export function renderGrade(id: RenderGradeId): string {
  switch (id) {
    case 'caldo': return 'saturate(1.15) sepia(.18) contrast(1.05)'
    case 'freddo': return 'saturate(.9) hue-rotate(-8deg) contrast(1.08) brightness(1.02)'
    case 'bn': return 'grayscale(1) contrast(1.15)'
    default: return 'none'
  }
}

export function formatSize(format: RenderFormat): [number, number] {
  return format === 'orizzontale' ? [1280, 720] : [720, 1280]
}

/** Fallback grid when the user provides no music: a steady 120 bpm. */
export function fallbackBeats(durationSec: number, bpm = 120): number[] {
  const period = 60 / bpm
  const beats: number[] = []
  for (let t = 0; t < durationSec + 2; t += period) beats.push(Number(t.toFixed(3)))
  return beats
}

export interface PlanShotInput {
  key: string
  durationSec: number
}

/** Snap the plan's shot boundaries to the beat grid, preserving the plan's
 *  order and the total duration budget. Pure and deterministic. */
export function snapPlanToBeats(shots: PlanShotInput[], beats: number[], totalSec: number): Array<{ key: string; from: number; to: number }> {
  const budget = Math.max(1, Math.min(totalSec, RENDER_LIMITS.maxDurationSec))
  const sorted = [...beats].sort((a, b) => a - b)
  const result: Array<{ key: string; from: number; to: number }> = []
  let cursor = 0
  for (const shot of shots.slice(0, RENDER_LIMITS.maxClips)) {
    const desired = cursor + Math.max(0.4, shot.durationSec)
    const beat = sorted.find((candidate) => candidate >= desired - 0.18 && candidate <= budget) ?? desired
    const to = Math.min(budget, Math.max(cursor + 0.35, beat))
    result.push({ key: shot.key, from: Number(cursor.toFixed(3)), to: Number(to.toFixed(3)) })
    cursor = to
    if (cursor >= budget - 0.05) break
  }
  return result
}

export function estimateSizeBytes(totalSec: number, format: RenderFormat): number {
  const bitrate = format === 'orizzontale' ? 5_000_000 : 3_200_000
  return Math.round((totalSec * bitrate) / 8)
}

export function renderUnsupported(): string | null {
  if (typeof window === 'undefined') return 'no-window'
  if (!('MediaRecorder' in window)) return 'no-recorder'
  if (!('captureStream' in HTMLCanvasElement.prototype)) return 'no-capture'
  return null
}

interface RenderClip {
  order: number
  kind: 'image' | 'video'
  file: File
  url: string
}

interface RenderShot {
  from: number
  to: number
  clipIndex: number
  startInClip: number
}

export interface RenderRequest {
  plan: MontagePlan
  files: Map<string, File>
  music: File | null
  style: RenderStyleId
  grade: RenderGradeId
  format: RenderFormat
  onProgress?: (phase: string, value: number) => void
  isCancelled?: () => boolean
}

export interface RenderResult {
  blob: Blob
  mime: string
  extension: 'mp4' | 'webm'
  durationSec: number
  sizeBytes: number
}

function bestMime(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const mime of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(mime)) return mime
  }
  return ''
}

/** Beat grid from a music file (energy flux + autocorrelation), bounded to
 *  the pilot duration. Returns null when the file cannot be decoded. */
export async function analyzeMusic(file: File | null, durationSec: number): Promise<number[] | null> {
  if (!file) return fallbackBeats(durationSec)
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return fallbackBeats(durationSec)
    const ctx = new AudioCtx()
    const audio = await ctx.decodeAudioData(await file.arrayBuffer())
    ctx.close()
    const sr = audio.sampleRate
    const hop = 512
    const channel = audio.getChannelData(0)
    const frames = Math.floor(channel.length / hop)
    const energy = new Float32Array(frames)
    for (let i = 0; i < frames; i += 1) {
      let sum = 0
      for (let j = 0; j < hop; j += 1) { const sample = channel[i * hop + j] ?? 0; sum += sample * sample }
      energy[i] = Math.sqrt(sum / hop)
    }
    const flux = new Float32Array(frames)
    for (let i = 1; i < frames; i += 1) flux[i] = Math.max(0, energy[i]! - energy[i - 1]!)
    const fps = sr / hop
    const minLag = Math.floor(fps * 60 / 170)
    const maxLag = Math.ceil(fps * 60 / 70)
    let lag = Math.round(fps / 2)
    let best = -1
    for (let candidate = minLag; candidate <= maxLag; candidate += 1) {
      let score = 0
      for (let i = candidate; i < frames; i += 1) score += flux[i]! * flux[i - candidate]!
      score *= Math.exp(-0.5 * Math.pow(Math.log2((60 * fps / candidate) / 120) / 0.5, 2))
      if (score > best) { best = score; lag = candidate }
    }
    const period = lag / fps
    if (!Number.isFinite(period) || period <= 0.2) return fallbackBeats(durationSec)
    const beats: number[] = []
    for (let t = 0; t < Math.min(durationSec + 1, audio.duration); t += period) beats.push(Number(t.toFixed(3)))
    return beats.length > 1 ? beats : fallbackBeats(durationSec)
  } catch {
    return fallbackBeats(durationSec)
  }
}

/** Render the plan as a short video, beat-aligned. Real-time encoding: the
 *  operator must keep the tab in the foreground. Abortable. */
export async function renderMontage(request: RenderRequest): Promise<RenderResult> {
  const unsupported = renderUnsupported()
  if (unsupported) throw new Error(`unsupported:${unsupported}`)
  const { plan, files, style, grade, format } = request
  const [width, height] = formatSize(format)
  const totalSec = Math.min(RENDER_LIMITS.maxDurationSec, plan.totalSec)
  const beats = (await analyzeMusic(request.music, totalSec)) ?? fallbackBeats(totalSec)
  const visualShots = plan.shots.filter((shot) => shot.role !== 'bed').slice(0, RENDER_LIMITS.maxClips)
  const snapped = snapPlanToBeats(visualShots.map((shot) => ({ key: shot.key, durationSec: shot.durationSec })), beats, totalSec)
  if (snapped.length === 0) throw new Error('empty')

  const clips: RenderClip[] = []
  const shotForSnap: RenderShot[] = []
  for (const [order, shot] of snapped.entries()) {
    const item = visualShots.find((entry) => entry.key === shot.key)
    const file = item ? files.get(item.key) : null
    if (!file) continue
    const isVideo = file.type.startsWith('video')
    const url = URL.createObjectURL(file)
    const clipIndex = clips.length
    clips.push({ order, kind: isVideo ? 'video' : 'image', file, url })
    shotForSnap.push({ from: shot.from, to: shot.to, clipIndex, startInClip: 0 })
  }
  if (clips.length === 0) throw new Error('empty')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-canvas')

  const elements: Array<HTMLImageElement | HTMLVideoElement> = []
  for (const clip of clips) {
    if (clip.kind === 'image') {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('image'))
        image.src = clip.url
      })
      elements.push(image)
    } else {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error('video'))
        video.src = clip.url
      })
      video.currentTime = 0
      elements.push(video)
    }
  }

  const stream = canvas.captureStream(RENDER_LIMITS.fps)
  let audioCtx: AudioContext | null = null
  let source: AudioBufferSourceNode | null = null
  if (request.music) {
    try {
      const AudioCtx = window.AudioContext
      if (AudioCtx) {
        audioCtx = new AudioCtx()
        const buffer = await audioCtx.decodeAudioData(await request.music.arrayBuffer())
        const destination = audioCtx.createMediaStreamDestination()
        const gain = audioCtx.createGain()
        source = audioCtx.createBufferSource()
        source.buffer = buffer
        source.connect(gain)
        gain.connect(destination)
        gain.connect(audioCtx.destination)
        destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track))
      }
    } catch {
      audioCtx = null
    }
  }

  const mime = bestMime()
  const recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: format === 'orizzontale' ? 5_000_000 : 3_200_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })

  const styleConfig = renderStyle(style)
  const gradeFilter = renderGrade(grade)
  const start = performance.now()
  recorder.start(250)
  try { source?.start(0) } catch { /* no audio */ }

  await new Promise<void>((resolve) => {
    const frame = () => {
      const t = (performance.now() - start) / 1000
      if (request.isCancelled?.() || t >= totalSec) { resolve(); return }
      const shot = shotForSnap.find((entry) => t >= entry.from && t < entry.to) ?? shotForSnap[shotForSnap.length - 1]!
      const clip = clips[shot.clipIndex]!
      const element = elements[shot.clipIndex]!
      if (clip.kind === 'video') {
        const video = element as HTMLVideoElement
        if (video.paused) void video.play().catch(() => undefined)
      }
      const u = Math.min(1, (t - shot.from) / Math.max(0.01, shot.to - shot.from))
      ctx.filter = gradeFilter
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, width, height)
      const sourceW = clip.kind === 'image' ? (element as HTMLImageElement).naturalWidth : (element as HTMLVideoElement).videoWidth
      const sourceH = clip.kind === 'image' ? (element as HTMLImageElement).naturalHeight : (element as HTMLVideoElement).videoHeight
      const zoom = styleConfig.zoom * (clip.kind === 'image' ? u * 2 : u)
      const scale = Math.max(width / Math.max(1, sourceW), height / Math.max(1, sourceH)) * (1 + zoom)
      const drawW = sourceW * scale
      const drawH = sourceH * scale
      try { ctx.drawImage(element, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH) } catch { /* not ready */ }
      ctx.filter = 'none'
      request.onProgress?.('render', t / totalSec)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  recorder.stop()
  await stopped
  try { source?.stop() } catch { /* already stopped */ }
  audioCtx?.close()
  elements.forEach((element) => { if (element instanceof HTMLVideoElement) element.pause() })
  clips.forEach((clip) => URL.revokeObjectURL(clip.url))

  const blob = new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] })
  if (blob.size > RENDER_LIMITS.maxSizeBytes) throw new Error('too-large')
  const extension: 'mp4' | 'webm' = blob.type.includes('mp4') ? 'mp4' : 'webm'
  return { blob, mime: blob.type, extension, durationSec: totalSec, sizeBytes: blob.size }
}
