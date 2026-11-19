/** Multi-agent post-production for a bulk batch — deterministic, no model.
 *
 *  Agents (pure functions sharing one context):
 *   · TaggerAgent   — tags + date + day-part from file names and batch tags;
 *   · TimeAgent     — day type and service period from the date/day-part;
 *   · GeoAgent      — place from TAGS only (exact name tokens), anonymous cell;
 *   · UtteranceAgent— one de-identified sentence built only from derived fields;
 *   · MontageAgent  — montage typology from the filtering categories;
 *   · CoherenceAgent— groups files into reviewable story candidates.
 *
 *  The orchestrator composes them and never invents: every field carries the
 *  factor that produced it, so the review list can be audited. */

import type { City } from '../cities.js'
import type { DramaturgicalZone } from '../pipeline/dramaturgical-zones.js'
import { planMontage } from '../../core/montage/planner.js'
import type { MontagePlan, MontageStyleId } from '../../core/montage/types.js'
import { BULK_LIMITS, bulkKindOf } from './limits.js'
import { geoFromPlace, matchPlace, type GeoFromTag, type PlaceMatch } from './geo.js'
import { dayTypeOf, parseDescriptor, servicePeriodOf, tokenize, type DayPart } from './tags.js'

export interface BulkItem {
  file: File
  name: string
  type: string
  size: number
  kind: 'image' | 'video' | 'audio' | 'text'
  tags: string[]
  date: string | null
  dayPart: DayPart | null
  place: PlaceMatch | null
  geo: GeoFromTag | null
  factors: string[]
}

export interface BulkCandidate {
  id: string
  key: string
  items: BulkItem[]
  tags: string[]
  date: string | null
  dayPart: DayPart | null
  dayType: 'weekday' | 'weekend' | 'unknown'
  servicePeriod: string
  place: PlaceMatch | null
  geo: GeoFromTag | null
  utterance: string
  mediaKinds: string[]
  montageStyleId: MontageStyleId
  montagePlan: MontagePlan
  warnings: string[]
  factors: string[]
  score: number
}

export interface BulkContext {
  zones: DramaturgicalZone[]
  cities: City[]
  lang: 'it' | 'en'
  globalTags?: string[]
}

function transportTags(tags: string[]): boolean {
  const words = new Set(['bus', 'metro', 'metropolitana', 'tram', 'treno', 'traffico', 'traffic', 'ritardo', 'delay', 'ligne', 'linea', 'line', 'fermata', 'stop', 'stazione', 'station'])
  return tags.some((tag) => words.has(tag) || /^(bus|metro|tram|line|ligne|linea)\d*$/.test(tag))
}

function chooseMontage(items: BulkItem[], tags: string[]): MontageStyleId {
  if (transportTags(tags)) return 'functional'
  if (items.some((item) => item.kind === 'video' || item.kind === 'audio')) return 'fictional'
  if (items.filter((item) => item.kind === 'image').length >= 3) return 'community'
  return 'functional'
}

function utteranceOf(fields: { place: PlaceMatch | null, date: string | null, dayPart: DayPart | null, count: number, tags: string[], lang: 'it' | 'en' }): string {
  const { place, date, dayPart, count, tags, lang } = fields
  const where = place ? place.name : (lang === 'it' ? 'luogo da confermare' : 'place to confirm')
  const when = date ? ` · ${date}` : ''
  const part = dayPart ? ` · ${dayPart}` : ''
  const tagList = tags.slice(0, 4).join(', ')
  if (lang === 'it') {
    return `${where}${when}${part}: ${count} media${tagList ? ` con tag ${tagList}` : ''}.`
  }
  return `${where}${when}${part}: ${count} media${tagList ? ` tagged ${tagList}` : ''}.`
}

/** Analyze one file through the agents (pure). */
export function analyzeItem(file: File, context: BulkContext): BulkItem | null {
  const kind = bulkKindOf(file.type, file.name)
  if (!kind) return null
  const parsed = parseDescriptor({ name: file.name }, context.globalTags ?? [])
  const place = matchPlace(parsed.tags, context.zones, context.cities)
  const geo = place ? geoFromPlace(place) : null
  const factors = [
    ...parsed.factors,
    place ? `place:${place.id}@${place.confidence}` : 'place:none',
    geo ? `cell:${geo.index}` : 'cell:none',
  ]
  return {
    file,
    name: file.name,
    type: file.type,
    size: file.size,
    kind,
    tags: parsed.tags,
    date: parsed.date,
    dayPart: parsed.dayPart,
    place,
    geo,
    factors,
  }
}

/** Group items into reviewable candidates: place + date define a story. */
export function runBulkAgents(files: File[], context: BulkContext): BulkCandidate[] {
  const items = files
    .map((file) => analyzeItem(file, context))
    .filter((item): item is BulkItem => !!item)
    .sort((a, b) => a.name.localeCompare(b.name))

  const groups = new Map<string, BulkItem[]>()
  for (const item of items) {
    const key = `${item.place?.id ?? 'no-place'}|${item.date ?? 'no-date'}`
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }

  const candidates: BulkCandidate[] = []
  for (const [key, groupItems] of groups) {
    const place = groupItems[0]!.place
    const geo = groupItems[0]!.geo
    const date = groupItems[0]!.date
    const dayPart = groupItems[0]!.dayPart
    const tags: string[] = []
    for (const item of groupItems) for (const tag of item.tags) if (!tags.includes(tag)) tags.push(tag)
    tags.sort((a, b) => a.localeCompare(b))

    const mediaKinds = [...new Set(groupItems.map((item) => item.kind))]
    const warnings: string[] = []
    let usable = groupItems
    if (groupItems.length > 8) {
      usable = groupItems.slice(0, 8)
      warnings.push('trimmed')
    }
    if (!place) warnings.push('no_place')
    if (!date) warnings.push('no_date')
    if (usable.length < 2) warnings.push('few_media')
    if (mediaKinds.length === 1) warnings.push('single_kind')

    const montageStyleId = chooseMontage(usable, tags)
    const montagePlan = planMontage({
      items: usable.map((item) => ({
        key: item.name,
        kind: item.kind,
        size: item.size,
        ...(item.date ? { capturedAt: `${item.date}T12:00:00Z` } : {}),
        cell: item.geo?.index ?? null,
      })),
      styleId: montageStyleId,
      themeBias: null,
    })

    const utterance = utteranceOf({ place, date, dayPart, count: usable.length, tags, lang: context.lang })
    const score = Math.round(
      40 + 20 * (place?.confidence ?? 0) + (date ? 15 : 0) + Math.min(15, usable.length * 3) + (mediaKinds.length > 1 ? 10 : 0),
    )
    const factors = [
      `group:${key}`,
      `items:${usable.length}`,
      place ? `place:${place.id}` : 'place:none',
      `montage:${montageStyleId}`,
      ...(warnings.length ? [`warnings:${warnings.join(',')}`] : []),
    ]

    candidates.push({
      id: `cand_${key.replace(/[^a-z0-9]+/gi, '_')}`,
      key,
      items: usable,
      tags,
      date,
      dayPart,
      dayType: dayTypeOf(date),
      servicePeriod: servicePeriodOf(dayPart),
      place,
      geo,
      utterance,
      mediaKinds,
      montageStyleId,
      montagePlan,
      warnings,
      factors,
      score,
    })
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, BULK_LIMITS.maxCandidates)
}

/** Tags of a batch used for a quick sanity display (sorted, deduped). */
export function batchTags(tags: string[]): string[] {
  const set = new Set<string>()
  for (const tag of tags.flatMap((entry) => tokenize(entry))) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b))
}
