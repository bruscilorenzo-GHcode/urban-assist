import { describe, expect, it } from 'vitest'
import { planMontage, formatSec } from '../src/core/montage/planner'
import type { MontageItem } from '../src/core/montage/types'

const item = (key: string, kind: MontageItem['kind'], extra: Partial<MontageItem> = {}): MontageItem => ({
  key, kind, size: 1000, ...extra,
})

const items: MontageItem[] = [
  item('b', 'image', { capturedAt: '2026-03-02T10:00:00Z', cell: 'gr_1', size: 900, theme: 'memoria', caption: 'la piazza vuota' }),
  item('a', 'video', { capturedAt: '2026-03-01T08:00:00Z', cell: 'gr_2', size: 5000, durationSec: 12, theme: 'mobilità' }),
  item('c', 'text', { capturedAt: '2026-03-03T09:00:00Z', cell: 'gr_1', size: 300, theme: 'memoria' }),
  item('d', 'audio', { capturedAt: '2026-03-02T11:00:00Z', durationSec: 40, caption: 'voci dal mercato' }),
  item('e', 'image', { capturedAt: '2026-03-04T12:00:00Z', cell: 'gr_2', size: 800 }),
]

describe('montage planner', () => {
  it('is deterministic for the same input', () => {
    const a = planMontage({ items, styleId: 'functional' })
    const b = planMontage({ items, styleId: 'functional' })
    expect(a).toEqual(b)
  })

  it('functional: chronological, hard cuts, open/close roles', () => {
    const plan = planMontage({ items, styleId: 'functional' })
    expect(plan.order).toEqual(['a', 'b', 'c', 'e'])
    const shots = plan.shots.filter((shot) => shot.kind !== 'audio')
    expect(shots[0]!.role).toBe('open')
    expect(shots[shots.length - 1]!.role).toBe('close')
    expect(shots.slice(1).every((shot) => shot.transition === 'cut')).toBe(true)
    // video duration is clamped by the style maximum (8s)
    expect(shots.find((shot) => shot.key === 'a')!.durationSec).toBe(8)
  })

  it('fictional: biggest material first, dissolves, alternating ends', () => {
    const plan = planMontage({ items, styleId: 'fictional' })
    const visual = plan.order
    expect(visual[0]).toBe('a') // largest (video 5k, clamped duration)
    expect(plan.shots.find((shot) => shot.key === 'a')!.transition).toBe('cut')
    expect(plan.shots.filter((shot) => shot.kind !== 'audio').slice(1).every((shot) => shot.transition === 'dissolve')).toBe(true)
  })

  it('proximity: groups cells by presence, then chronological inside', () => {
    const plan = planMontage({ items, styleId: 'proximity' })
    // gr_1 and gr_2 each have 2 visual items; groups tie → lexicographic cell order
    expect(plan.order).toEqual(['b', 'c', 'a', 'e'])
  })

  it('place: cells in order, one place at a time', () => {
    const plan = planMontage({ items, styleId: 'place' })
    expect(plan.order).toEqual(['b', 'c', 'a', 'e'])
  })

  it('topic: the chosen theme comes first, the rest as context', () => {
    const plan = planMontage({ items, styleId: 'topic', themeBias: 'memoria' })
    expect(plan.order[0]).toBe('b')
    expect(plan.themeBias).toBe('memoria')
  })

  it('community: alternates media kinds', () => {
    const plan = planMontage({ items, styleId: 'community' })
    const kinds = plan.order.map((key) => items.find((entry) => entry.key === key)!.kind)
    expect(kinds[0]).not.toBe(kinds[1])
  })

  it('adds one audio bed and per-item captions/timelines', () => {
    const plan = planMontage({ items, styleId: 'fictional' })
    const bed = plan.shots.find((shot) => shot.role === 'bed')
    expect(bed?.key).toBe('d')
    expect(bed?.startSec).toBe(0)
    for (const key of plan.order) {
      expect(plan.captions[key]).toBeTruthy()
      expect(plan.timelines[key]).toMatch(/open|develop|close|intertitle/)
    }
    expect(plan.totalSec).toBeGreaterThan(0)
    expect(formatSec(plan.totalSec)).toMatch(/^\d+:\d{2}$/)
  })

  it('declares coherence honestly when the material is thin', () => {
    const thin = planMontage({ items: [item('x', 'image')], styleId: 'functional' })
    expect(thin.coherence.score).toBeLessThan(80)
    expect(thin.coherence.warnings).toContain('few_items')
    expect(thin.coherence.warnings).toContain('no_motion')

    const allImages = planMontage({
      items: [item('i1', 'image'), item('i2', 'image'), item('i3', 'image')],
      styleId: 'functional',
    })
    expect(allImages.coherence.warnings).toContain('same_media')
  })
})
