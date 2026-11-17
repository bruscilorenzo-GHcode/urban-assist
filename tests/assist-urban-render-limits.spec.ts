import { describe, expect, it } from 'vitest'
import {
  RENDER_LIMITS,
  estimateSizeBytes,
  fallbackBeats,
  renderGrade,
  renderStyle,
  snapPlanToBeats,
} from '../src/assist-urban/render/beat-montage'

describe('limited video renderer (pure parts)', () => {
  it('keeps hard limits for the pilot', () => {
    expect(RENDER_LIMITS.maxDurationSec).toBe(15)
    expect(RENDER_LIMITS.maxClips).toBeLessThanOrEqual(8)
    expect(RENDER_LIMITS.maxSizeBytes).toBeLessThanOrEqual(20 * 1024 * 1024)
  })

  it('falls back to a 120 bpm grid without music', () => {
    const beats = fallbackBeats(8)
    expect(beats[0]).toBe(0)
    expect(beats[1]).toBeCloseTo(0.5, 3)
    expect(beats.length).toBeGreaterThanOrEqual(16)
  })

  it('snaps the plan order onto the beat grid within the budget', () => {
    const shots = [
      { key: 'a', durationSec: 2 },
      { key: 'b', durationSec: 2.4 },
      { key: 'c', durationSec: 3 },
    ]
    const cuts = snapPlanToBeats(shots, fallbackBeats(15), 15)
    expect(cuts.map((cut) => cut.key)).toEqual(['a', 'b', 'c'])
    expect(cuts[0]!.from).toBe(0)
    for (let i = 1; i < cuts.length; i += 1) {
      expect(cuts[i]!.from).toBe(cuts[i - 1]!.to)
      expect(cuts[i]!.to).toBeGreaterThan(cuts[i]!.from)
    }
    expect(cuts[cuts.length - 1]!.to).toBeLessThanOrEqual(15)
  })

  it('never exceeds the duration cap even with long shots', () => {
    const shots = Array.from({ length: 12 }, (_, i) => ({ key: `s${i}`, durationSec: 10 }))
    const cuts = snapPlanToBeats(shots, fallbackBeats(60), 60)
    expect(cuts.length).toBeLessThanOrEqual(RENDER_LIMITS.maxClips)
    expect(cuts[cuts.length - 1]!.to).toBeLessThanOrEqual(RENDER_LIMITS.maxDurationSec)
  })

  it('is deterministic', () => {
    const shots = [{ key: 'a', durationSec: 3 }, { key: 'b', durationSec: 4 }]
    expect(snapPlanToBeats(shots, fallbackBeats(15), 12)).toEqual(snapPlanToBeats(shots, fallbackBeats(15), 12))
  })

  it('estimates size from duration and format', () => {
    const vertical = estimateSizeBytes(15, 'verticale')
    const horizontal = estimateSizeBytes(15, 'orizzontale')
    expect(vertical).toBeGreaterThan(0)
    expect(horizontal).toBeGreaterThan(vertical)
    expect(vertical).toBeLessThan(RENDER_LIMITS.maxSizeBytes)
  })

  it('exposes bounded render styles and grades', () => {
    for (const style of ['calmo', 'ritmato', 'energico'] as const) {
      const config = renderStyle(style)
      expect(config.beatsPerCut).toBeGreaterThanOrEqual(1)
      expect(config.zoom).toBeLessThanOrEqual(0.1)
    }
    expect(renderGrade('bn')).toContain('grayscale')
    expect(renderGrade('naturale')).toBe('none')
  })
})
