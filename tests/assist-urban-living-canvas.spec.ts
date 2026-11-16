import { describe, expect, it } from 'vitest'
import { clamp01, filamentWidth, hash01, nearestOnSamples, sampleCubic, tendrilControls } from '../src/assist-urban/living-canvas'

describe('living canvas geometry', () => {
  it('thickness carries the relation weight', () => {
    expect(filamentWidth(0)).toBeCloseTo(1.2, 5)
    expect(filamentWidth(1)).toBeCloseTo(8.2, 5)
    expect(filamentWidth(0.5)).toBeGreaterThan(filamentWidth(0.2))
    expect(filamentWidth(4)).toBe(filamentWidth(1))
    expect(filamentWidth(-3)).toBeCloseTo(1.2, 5)
  })

  it('hash01 is deterministic and normalized', () => {
    expect(hash01('edge-a', 3)).toBe(hash01('edge-a', 3))
    expect(hash01('edge-a', 3)).not.toBe(hash01('edge-a', 4))
    for (const seed of ['a', 'b', 'topic:x', 'proximity:1']) {
      const value = hash01(seed, 0)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
    expect(clamp01(2)).toBe(1)
    expect(clamp01(-1)).toBe(0)
  })

  it('tendril controls are deterministic and vary per tendril', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 100, y: 40 }
    const a = tendrilControls(from, to, 'edge-1', 0)
    const b = tendrilControls(from, to, 'edge-1', 0)
    const c = tendrilControls(from, to, 'edge-1', 1)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    // controls stay near the chord's middle band, not off-canvas
    for (const control of [a.c1, a.c2]) {
      expect(Number.isFinite(control.x)).toBe(true)
      expect(Math.abs(control.x)).toBeLessThan(200)
      expect(Math.abs(control.y)).toBeLessThan(200)
    }
  })

  it('samples a cubic from the first node to the second', () => {
    const p0 = { x: 0, y: 0 }
    const p1 = { x: 10, y: 20 }
    const c1 = { x: 3, y: 8 }
    const c2 = { x: 7, y: 14 }
    expect(sampleCubic(p0, c1, c2, p1, 0)).toEqual({ x: 0, y: 0 })
    expect(sampleCubic(p0, c1, c2, p1, 1)).toEqual({ x: 10, y: 20 })
    const out = { x: 0, y: 0 }
    expect(sampleCubic(p0, c1, c2, p1, 0.5, out)).toBe(out)
    expect(Number.isFinite(out.x)).toBe(true)
  })

  it('finds the nearest sampled point for inspection', () => {
    const samples = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]
    expect(nearestOnSamples(samples, 9, 2).index).toBe(1)
    expect(nearestOnSamples(samples, 40, 40).distance).toBeGreaterThan(20)
  })
})
