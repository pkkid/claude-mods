import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_BURN, addSample, project } from '../src/burnrate'

const MIN = 60_000
const T0 = new Date(2026, 9, 4, 12, 0).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

function burn(resetsAt: number, ...points: [number, number][]) {
  return points.reduce((s, [minutes, pct]) => addSample(s, T0 + minutes * MIN, pct, iso(resetsAt)), EMPTY_BURN)
}

describe('project', () => {
  test('projects linearly to 100%', () => {
    const s = burn(T0 + 300 * MIN, [0, 10], [30, 20])
    expect(project(s, T0 + 30 * MIN)).toBe(T0 + 270 * MIN)
  })

  test('null when the limit lands after the reset', () => {
    const s = burn(T0 + 200 * MIN, [0, 10], [30, 20])
    expect(project(s, T0 + 30 * MIN)).toBeNull()
  })

  test('null when samples span under 10 minutes', () => {
    const s = burn(T0 + 300 * MIN, [0, 10], [5, 20])
    expect(project(s, T0 + 5 * MIN)).toBeNull()
  })

  test('null when usage is not rising', () => {
    const s = burn(T0 + 300 * MIN, [0, 30], [30, 20])
    expect(project(s, T0 + 30 * MIN)).toBeNull()
  })
})

describe('addSample', () => {
  test('a new window clears samples', () => {
    const s = burn(T0 + 300 * MIN, [0, 10], [30, 20])
    const next = addSample(s, T0 + 40 * MIN, 1, iso(T0 + 600 * MIN))
    expect(next.samples).toEqual([{ t: T0 + 40 * MIN, pct: 1 }])
  })

  test('an unchanged percentage is not appended', () => {
    const s = burn(T0 + 300 * MIN, [0, 10], [5, 10])
    expect(s.samples).toHaveLength(1)
  })

  test('samples older than an hour are dropped', () => {
    const s = burn(T0 + 300 * MIN, [0, 10], [30, 20], [70, 30])
    expect(s.samples.map(x => x.pct)).toEqual([20, 30])
  })
})
