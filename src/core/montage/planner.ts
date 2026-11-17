import { styleById } from './styles.js'
import type {
  MontageCoherence,
  MontageItem,
  MontagePlan,
  MontageRole,
  MontageStyle,
  MontageWarning,
  PlanInput,
  PlannedShot,
} from './types.js'

const INTER_TITLE_SEC = 3
const BED_SEC = 20

function stableCompare(a: string, b: string): number {
  return a.localeCompare(b)
}

function timeOf(item: MontageItem): string {
  return item.capturedAt ?? ''
}

function cellOf(item: MontageItem): string {
  return item.cell ?? '∅'
}

function visualItems(items: MontageItem[]): MontageItem[] {
  return items.filter((item) => item.kind === 'image' || item.kind === 'video' || item.kind === 'text')
}

function shotDuration(item: MontageItem, style: MontageStyle): number {
  if (item.kind === 'text') return INTER_TITLE_SEC
  if (item.kind === 'image') return style.cadenceSec
  const known = typeof item.durationSec === 'number' && Number.isFinite(item.durationSec) ? item.durationSec : style.cadenceSec
  return Math.max(2, Math.min(known, style.maxShotSec))
}

/** Order the visual items according to the chosen filtering category. */
export function orderItems(items: MontageItem[], styleId: PlanInput['styleId'], themeBias?: string | null): MontageItem[] {
  const visual = visualItems(items)
  switch (styleId) {
    case 'functional':
      return [...visual].sort((a, b) => stableCompare(timeOf(a), timeOf(b)) || stableCompare(a.key, b.key))
    case 'fictional': {
      const bySize = [...visual].sort((a, b) => b.size - a.size || stableCompare(a.key, b.key))
      const out: MontageItem[] = []
      let left = 0
      let right = bySize.length - 1
      while (left <= right) {
        if (left === right) { out.push(bySize[left]!); break }
        out.push(bySize[left]!, bySize[right]!)
        left += 1
        right -= 1
      }
      return out
    }
    case 'proximity': {
      const groups = new Map<string, MontageItem[]>()
      for (const item of visual) {
        const list = groups.get(cellOf(item)) ?? []
        list.push(item)
        groups.set(cellOf(item), list)
      }
      return [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length || stableCompare(a[0], b[0]))
        .flatMap(([, list]) => [...list].sort((a, b) => stableCompare(timeOf(a), timeOf(b)) || stableCompare(a.key, b.key)))
    }
    case 'place': {
      const groups = new Map<string, MontageItem[]>()
      for (const item of visual) {
        const list = groups.get(cellOf(item)) ?? []
        list.push(item)
        groups.set(cellOf(item), list)
      }
      return [...groups.entries()]
        .sort((a, b) => stableCompare(a[0], b[0]))
        .flatMap(([, list]) => [...list].sort((a, b) => stableCompare(timeOf(a), timeOf(b)) || stableCompare(a.key, b.key)))
    }
    case 'topic': {
      const matches = (item: MontageItem) => !!themeBias && item.theme === themeBias
      const onTopic = visual.filter(matches).sort((a, b) => stableCompare(timeOf(a), timeOf(b)) || stableCompare(a.key, b.key))
      const rest = visual.filter((item) => !matches(item)).sort((a, b) => stableCompare(timeOf(a), timeOf(b)) || stableCompare(a.key, b.key))
      return [...onTopic, ...rest]
    }
    case 'community': {
      // Round-robin by kind, chronological within each kind: no material dominates.
      const buckets = new Map<string, MontageItem[]>()
      for (const item of [...visual].sort((a, b) => stableCompare(timeOf(a), timeOf(b)) || stableCompare(a.key, b.key))) {
        const list = buckets.get(item.kind) ?? []
        list.push(item)
        buckets.set(item.kind, list)
      }
      const out: MontageItem[] = []
      let remaining = visual.length
      while (remaining > 0) {
        for (const kind of ['image', 'video', 'text']) {
          const list = buckets.get(kind)
          const next = list?.shift()
          if (next) { out.push(next); remaining -= 1 }
        }
      }
      return out
    }
  }
}

function captionFor(item: MontageItem, role: MontageRole, styleId: PlanInput['styleId']): string {
  if (item.caption?.trim()) return item.caption.trim().slice(0, 80)
  const kind = item.kind === 'image' ? 'foto' : item.kind === 'video' ? 'video' : 'testo'
  const roleWord = role === 'open' ? 'apertura' : role === 'close' ? 'chiusura' : 'sviluppo'
  const t = item.capturedAt ? item.capturedAt.slice(0, 16).replace('T', ' ') : 'senza orario'
  return `${roleWord} · ${kind} · ${t}${styleId === 'topic' && item.theme ? ` · ${item.theme}` : ''}`
}

function styleIsRelational(shots: PlannedShot[]): boolean {
  return shots.some((shot) => shot.reason.startsWith('proximity') || shot.reason.startsWith('place'))
}

function coherenceOf(items: MontageItem[], shots: PlannedShot[]): MontageCoherence {
  const visual = items.filter((item) => item.kind === 'image' || item.kind === 'video' || item.kind === 'text')
  const kinds = new Set(visual.map((item) => item.kind))
  const counts = new Map<string, number>()
  for (const item of visual) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
  const dominant = Math.max(0, ...counts.values())
  const balance = visual.length ? dominant / visual.length : 0
  const diversity = visual.length ? kinds.size / visual.length : 0
  const cells = new Set(items.map(cellOf).filter((cell) => cell !== '∅'))
  const captions = items.filter((item) => !!item.caption?.trim()).length

  const warnings: MontageWarning[] = []
  let score = 100
  if (visual.length < 3) { warnings.push('few_items'); score -= 30 }
  if (visual.length > 0 && balance > 0.7) { warnings.push('same_media'); score -= 20 }
  if (!items.some((item) => item.kind === 'video' || item.kind === 'audio')) { warnings.push('no_motion'); score -= 10 }
  // Only relational typologies care about place: a single-place story is not
  // a defect for chronological or scene montages.
  if ((styleIsRelational(shots) && cells.size <= 1 && items.length > 1)) { warnings.push('no_geo'); score -= 10 }
  if (visual.length > 1 && captions < Math.ceil(visual.length / 2)) { warnings.push('few_captions'); score -= 5 }
  if (shots.length === 0) score = 0
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    balance: Number(balance.toFixed(2)),
    diversity: Number(diversity.toFixed(2)),
    warnings,
  }
}

/** Build the plan. Pure and deterministic for the same input. */
export function planMontage(input: PlanInput): MontagePlan {
  const style = styleById(input.styleId)
  const themeBias = input.themeBias ?? null
  const ordered = orderItems(input.items, input.styleId, themeBias)
  const audio = input.items.find((item) => item.kind === 'audio')
  const shots: PlannedShot[] = []
  let start = 0

  ordered.forEach((item, index) => {
    const role: MontageRole = index === 0
      ? 'open'
      : index === ordered.length - 1 ? 'close' : (item.kind === 'text' ? 'intertitle' : 'develop')
    const durationSec = Math.max(1, Math.round(shotDuration(item, style) * 10) / 10)
    shots.push({
      key: item.key,
      kind: item.kind,
      role,
      order: index,
      startSec: Math.round(start * 10) / 10,
      durationSec,
      transition: index === 0 ? 'cut' : (style.dissolve ? 'dissolve' : 'cut'),
      caption: captionFor(item, role, input.styleId),
      reason: `${style.id} · ${role}${item.cell ? ` · ${cellOf(item)}` : ''}${index > 0 ? ` · dopo ${ordered[index - 1]!.kind}` : ''}`,
    })
    start += durationSec
  })

  if (audio) {
    shots.push({
      key: audio.key,
      kind: 'audio',
      role: 'bed',
      order: shots.length,
      startSec: 0,
      durationSec: Math.min(BED_SEC, Math.max(5, Math.round((audio.durationSec ?? BED_SEC) * 10) / 10)),
      transition: 'cut',
      caption: audio.caption?.slice(0, 80) || 'letto sonoro · sotto il montaggio',
      reason: 'audio bed · accompagna l’intera sequenza',
    })
  }

  const captions: Record<string, string> = {}
  const timelines: Record<string, string> = {}
  for (const shot of shots) {
    captions[shot.key] = shot.caption
    timelines[shot.key] = `${shot.role} · ${formatSec(shot.startSec)}`
  }

  const totalSec = Math.round(start * 10) / 10
  return {
    styleId: input.styleId,
    themeBias,
    shots,
    totalSec,
    coherence: coherenceOf(input.items, shots),
    order: ordered.map((item) => item.key),
    captions,
    timelines,
  }
}

export function formatSec(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const mm = Math.floor(safe / 60)
  const ss = String(safe % 60).padStart(2, '0')
  return `${mm}:${ss}`
}
