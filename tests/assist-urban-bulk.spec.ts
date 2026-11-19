import { describe, expect, it } from 'vitest'
import { BULK_LIMITS, bulkKindOf, validateBulk } from '../src/assist-urban/bulk/limits'
import { dayTypeOf, parseDescriptor, servicePeriodOf, tokenize } from '../src/assist-urban/bulk/tags'
import { geoFromPlace, matchPlace } from '../src/assist-urban/bulk/geo'
import { analyzeItem, batchTags, runBulkAgents } from '../src/assist-urban/bulk/agents'
import { SEED_ZONES } from '../src/assist-urban/pipeline/dramaturgical-zones'
import type { City } from '../src/assist-urban/cities'

const CITIES: City[] = [
  { id: 'city_beirut_1', name: 'Beirut', center: [33.8938, 35.5018], zoom: 13, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'city_montevarchi_1', name: 'Montevarchi', center: [43.5247, 11.5673], zoom: 13, createdAt: '2026-01-01T00:00:00Z' },
]

const PILOT_ZONE = {
  id: 'dz_hamra_1', name: 'Hamra', label: 'Hamra · Beirut', status: 'active' as const, city: 'Beirut', origin: 'pilot' as const,
  focus: { it: 'Benessere', en: 'Wellbeing' }, center: [33.8938, 35.5018] as [number, number], zoom: 15,
  themeHint: { it: '', en: '' }, presets: [],
}

function file(name: string, type: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

describe('bulk limits', () => {
  it('accepts a full batch up to the limits and rejects beyond', () => {
    const small = () => [{ name: 'a.jpg', type: 'image/jpeg', size: 1024 }]
    expect(validateBulk(small())).toBeNull()
    expect(validateBulk(Array.from({ length: BULK_LIMITS.maxFiles + 1 }, (_, i) => ({ name: `${i}.jpg`, type: 'image/jpeg', size: 10 })))).toBe('too_many')
    expect(validateBulk([{ name: 'big.mp4', type: 'video/mp4', size: BULK_LIMITS.maxFileBytes }])).toBeNull()
    expect(validateBulk([{ name: 'big.mp4', type: 'video/mp4', size: BULK_LIMITS.maxFileBytes + 1 }])).toBe('file_too_large')
    expect(validateBulk([{ name: 'x.bin', type: 'application/zip', size: 10 }])).toBe('type')
    const heavy = Array.from({ length: 7 }, (_, i) => ({ name: `${i}.mp4`, type: 'video/mp4', size: 50 * 1024 * 1024 }))
    expect(validateBulk(heavy)).toBe('batch_too_large')
  })

  it('maps types to media kinds', () => {
    expect(bulkKindOf('image/jpeg', 'a.jpg')).toBe('image')
    expect(bulkKindOf('video/mp4', 'a.mp4')).toBe('video')
    expect(bulkKindOf('audio/mpeg', 'a.mp3')).toBe('audio')
    expect(bulkKindOf('text/plain', 'note.txt')).toBe('text')
    expect(bulkKindOf('application/pdf', 'doc.pdf')).toBeNull()
  })
})

describe('bulk tags and time', () => {
  it('parses separators, dates, day parts and global tags', () => {
    const parsed = parseDescriptor({ name: 'scicli__piazza-municipio__2026-03-02__mattina.jpg' }, ['#città', 'festa'])
    expect(parsed.date).toBe('2026-03-02')
    expect(parsed.dayPart).toBe('morning')
    expect(parsed.tags).toContain('piazza')
    expect(parsed.tags).toContain('municipio')
    expect(parsed.tags).toContain('festa')
    expect(parsed.tags).toContain('citta')
    expect(tokenize('Città!')).toEqual(['citta'])
  })

  it('derives day type and service period deterministically', () => {
    expect(dayTypeOf('2026-03-02')).toBe('weekday')
    expect(dayTypeOf('2026-03-07')).toBe('weekend')
    expect(dayTypeOf(null)).toBe('unknown')
    expect(servicePeriodOf('morning')).toBe('am_peak')
    expect(servicePeriodOf('evening')).toBe('evening')
    expect(servicePeriodOf(null)).toBe('unknown')
  })
})

describe('geo from tags only', () => {
  it('matches curated zones, pilot zones and cities by exact tokens', () => {
    const scicli = matchPlace(['scicli', 'piazza'], SEED_ZONES, CITIES)
    expect(scicli?.id).toBe('scicli')
    expect(scicli?.confidence).toBe(1)

    const hamra = matchPlace(['hamra', 'sera'], [...SEED_ZONES, PILOT_ZONE], CITIES)
    expect(hamra?.id).toBe('dz_hamra_1')

    const beirut = matchPlace(['beirut'], SEED_ZONES, CITIES)
    expect(beirut?.kind).toBe('zone')

    expect(matchPlace(['nonesiste'], SEED_ZONES, CITIES)).toBeNull()
    expect(matchPlace(['est'], SEED_ZONES, CITIES)).toBeNull()
  })

  it('derives an anonymous cell from the place centre', () => {
    const place = matchPlace(['scicli'], SEED_ZONES, CITIES)!
    const geo = geoFromPlace(place)
    expect(geo.index).toMatch(/^gr_r8_/)
    expect(geo.source).toBe('tag')
    expect(geo.confidence).toBeGreaterThan(0.9)
  })
})

describe('bulk orchestrator', () => {
  it('groups files into story candidates by place and date', () => {
    const files = [
      file('scicli__piazza-municipio__2026-03-02__mattina.jpg', 'image/jpeg'),
      file('scicli__piazza-municipio__2026-03-02__mattina-2.jpg', 'image/jpeg'),
      file('scicli__bus80__2026-03-02__mattina.mp4', 'video/mp4'),
      file('montevarchi__piazza__2026-03-03__sera.jpg', 'image/jpeg'),
    ]
    const candidates = runBulkAgents(files, { zones: SEED_ZONES, cities: CITIES, lang: 'it' })
    expect(candidates).toHaveLength(2)
    const scicli = candidates.find((candidate) => candidate.place?.id === 'scicli')!
    expect(scicli.items).toHaveLength(3)
    expect(scicli.geo?.source).toBe('tag')
    expect(scicli.utterance).toContain('Scicli')
    expect(scicli.utterance).toContain('2026-03-02')
    expect(scicli.montageStyleId).toBe('functional')
    expect(scicli.montagePlan.shots.length).toBeGreaterThan(0)

    const montevarchi = candidates.find((candidate) => candidate.place?.name === 'Montevarchi')!
    expect(montevarchi.place?.kind).toBe('city')
  })

  it('declares missing place and date instead of inventing them', () => {
    const candidates = runBulkAgents([file('img_0001.jpg', 'image/jpeg')], { zones: SEED_ZONES, cities: CITIES, lang: 'it' })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.place).toBeNull()
    expect(candidates[0]!.geo).toBeNull()
    expect(candidates[0]!.warnings).toContain('no_place')
    expect(candidates[0]!.warnings).toContain('no_date')
    expect(candidates[0]!.utterance).toContain('luogo da confermare')
  })

  it('trims a candidate above 8 media and says so', () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`scicli__piazza__2026-03-02__mattina_${i}.jpg`, 'image/jpeg'))
    const candidates = runBulkAgents(files, { zones: SEED_ZONES, cities: CITIES, lang: 'en' })
    expect(candidates[0]!.items).toHaveLength(8)
    expect(candidates[0]!.warnings).toContain('trimmed')
  })

  it('is deterministic and skips unsupported files', () => {
    const files = [
      file('beirut__corniche__2026-02-01__sera.jpg', 'image/jpeg'),
      file('notes.pdf', 'application/pdf'),
      file('beirut__corniche__2026-02-01__sera.mp3', 'audio/mpeg'),
    ]
    const a = runBulkAgents(files, { zones: SEED_ZONES, cities: CITIES, lang: 'en' })
    const b = runBulkAgents(files, { zones: SEED_ZONES, cities: CITIES, lang: 'en' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a[0]!.items).toHaveLength(2)
    expect(a[0]!.mediaKinds.sort()).toEqual(['audio', 'image'])
    expect(analyzeItem(file('x.pdf', 'application/pdf'), { zones: SEED_ZONES, cities: CITIES, lang: 'en' })).toBeNull()
  })

  it('sorts batch tags for display', () => {
    expect(batchTags(['#Scicli', 'piazza', 'scicli'])).toEqual(['piazza', 'scicli'])
  })
})
