/** Geo agent: places come from TAGS, never from inference.
 *
 *  The batch's tags (and file names) are matched against the declared zones
 *  and cities. An exact name token (length ≥ 4) or the full name token set
 *  produces a place; nothing else does. The output declares its source
 *  (`tag`) and confidence, and the anonymous cell is derived from the place
 *  centre with the app's deg-grid. */

import { obfuscatePoint } from '../pipeline/pii.js'
import type { City } from '../cities.js'
import type { DramaturgicalZone } from '../pipeline/dramaturgical-zones.js'
import { normalizeTag, tokenize } from './tags.js'

export interface PlaceMatch {
  id: string
  name: string
  kind: 'zone' | 'city'
  center: [number, number]
  city: string
  confidence: number
  matchedToken: string
}

interface PlaceCandidate {
  id: string
  name: string
  kind: 'zone' | 'city'
  center: [number, number]
  city: string
  tokens: Set<string>
}

function candidatesOf(zones: DramaturgicalZone[], cities: City[]): PlaceCandidate[] {
  const out: PlaceCandidate[] = []
  for (const zone of zones) {
    const tokens = new Set([...tokenize(zone.name), ...tokenize(zone.label), ...tokenize(zone.city)])
    out.push({ id: zone.id, name: zone.name, kind: 'zone', center: zone.center, city: zone.city, tokens })
  }
  for (const city of cities) {
    out.push({
      id: `city:${city.id}`,
      name: city.name,
      kind: 'city',
      center: city.center,
      city: city.name,
      tokens: new Set(tokenize(city.name)),
    })
  }
  return out
}

export function matchPlace(tags: string[], zones: DramaturgicalZone[], cities: City[]): PlaceMatch | null {
  const normalized = new Set(tags.map(normalizeTag))
  let best: PlaceMatch | null = null
  for (const candidate of candidatesOf(zones, cities)) {
    for (const token of candidate.tokens) {
      if (token.length < 4 || !normalized.has(token)) continue
      const confidence = tokenize(candidate.name).every((part) => normalized.has(part)) ? 1 : candidate.kind === 'zone' ? 0.85 : 0.7
      if (!best || confidence > best.confidence) {
        best = {
          id: candidate.id,
          name: candidate.name,
          kind: candidate.kind,
          center: candidate.center,
          city: candidate.city,
          confidence,
          matchedToken: token,
        }
      }
    }
  }
  return best
}

export interface GeoFromTag {
  index: string
  res: number
  source: 'tag'
  confidence: number
}

export function geoFromPlace(place: PlaceMatch, resolution = 8): GeoFromTag {
  const cell = obfuscatePoint(place.center[0], place.center[1], resolution)
  return { index: cell.index, res: resolution, source: 'tag', confidence: place.confidence }
}
