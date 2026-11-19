/** Deterministic tag extraction from file names and the batch tag field.
 *
 *  Convention: tokens separated by `__`, `_`, `-`, `+`, `,`, `#` or spaces;
 *  ISO dates (YYYY-MM-DD / YYYYMMDD) and day-part words are recognised and
 *  removed from the tag list. No inference: what is not in the name or in the
 *  batch tags does not exist. */

export type DayPart = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night'

const DAY_PART_WORDS: Record<string, DayPart> = {
  alba: 'dawn', dawn: 'dawn',
  mattina: 'morning', mattino: 'morning', morning: 'morning',
  pomeriggio: 'afternoon', afternoon: 'afternoon',
  sera: 'evening', evening: 'evening',
  notte: 'night', night: 'night',
}

const STOPWORDS = new Set([
  'img', 'image', 'photo', 'foto', 'picture', 'video', 'vid', 'audio', 'voice', 'voce',
  'clip', 'mov', 'jpg', 'jpeg', 'png', 'heic', 'mp4', 'webm', 'mp3', 'wav', 'm4a', 'txt', 'md', 'csv',
  'final', 'copy', 'copia', 'export', 'render',
])

export function normalizeTag(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function tokenize(value: string): string[] {
  return normalizeTag(value)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !STOPWORDS.has(token))
}

export interface ParsedDescriptor {
  tags: string[]
  date: string | null
  dayPart: DayPart | null
  factors: string[]
}

export function parseDescriptor(file: { name: string }, globalTags: string[] = []): ParsedDescriptor {
  const base = file.name.replace(/\.[a-z0-9]{2,5}$/i, '')
  const iso = base.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/)
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
  const tokens = tokenize(base).filter((token) => !(iso && iso[0].toLowerCase().includes(token)))

  let dayPart: DayPart | null = null
  for (const token of tokenize(base)) {
    const found = DAY_PART_WORDS[token]
    if (found) { dayPart = found; break }
  }

  const tags: string[] = []
  for (const token of [...tokens, ...globalTags.flatMap((tag) => tokenize(tag))]) {
    if (!tags.includes(token) && !(iso && iso[0].toLowerCase().includes(token))) tags.push(token)
  }

  const factors = [
    `name:${base}`,
    date ? `date:${date}` : 'date:none',
    dayPart ? `daypart:${dayPart}` : 'daypart:none',
    `tags:${tags.length}`,
  ]
  return { tags, date, dayPart, factors }
}

export function dayTypeOf(isoDate: string | null): 'weekday' | 'weekend' | 'unknown' {
  if (!isoDate) return 'unknown'
  const date = new Date(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'unknown'
  const day = date.getUTCDay()
  return day === 0 || day === 6 ? 'weekend' : 'weekday'
}

export function servicePeriodOf(dayPart: DayPart | null): 'am_peak' | 'midday' | 'pm_peak' | 'evening' | 'night' | 'unknown' {
  switch (dayPart) {
    case 'dawn': return 'night'
    case 'morning': return 'am_peak'
    case 'afternoon': return 'midday'
    case 'evening': return 'evening'
    case 'night': return 'night'
    default: return 'unknown'
  }
}
