import { describe, expect, test } from 'claude-code/testing'

import { fit, segments, toneFor } from '../src/bar'
import type { View } from '../src/bar'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { Settings } from '../types'

const MIN = 60_000
const NOW = new Date(2026, 9, 4, 12, 0).getTime() // Sunday noon

function view(over: Partial<View> = {}, settings: Partial<Settings> = {}): View {
  return {
    snapshot: {
      fiveHour: { percentUsed: 42, resetsAt: new Date(NOW + 72 * MIN).toISOString() },
      weekly: { percentUsed: 18, resetsAt: new Date(2026, 9, 8, 14, 0).toISOString() },
      context: { tokens: 62_400, window: 200_000, percent: 31 },
      threadUsd: 3.12,
      lastTurnUsd: 0.41,
    },
    month: { usd: 184.2, isEstimate: false, status: 'ready' },
    cacheAt: NOW - 18 * MIN,
    projection: new Date(2026, 9, 4, 15, 40).getTime(),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    now: NOW,
    ...over,
  }
}

const texts = (v: View) => segments(v).map(s => s.text)

describe('segments', () => {
  test('full bar matches the spec example', () => {
    expect(texts(view())).toEqual([
      '5h 42% ·1h12m',
      'wk 18% ·Thu',
      'ctx 31% 62k/200k',
      'cache 42m',
      'thread $3.12 (+$0.41)',
      'month $184.20',
      'limit ~3:40pm',
    ])
  })

  test('resets off drops countdowns', () => {
    expect(texts(view({}, { resets: false })).slice(0, 2)).toEqual(['5h 42%', 'wk 18%'])
  })

  test('context tokens off', () => expect(texts(view({}, { contextTokens: false }))).toContain('ctx 31%'))

  test('context percent off', () => expect(texts(view({}, { contextPercent: false }))).toContain('ctx 62k/200k'))

  test('last-turn cost stands alone when thread cost is off', () => {
    const t = texts(view({}, { threadCost: false }))
    expect(t).toContain('last $0.41')
    expect(t.some(x => x.startsWith('thread'))).toBe(false)
  })

  test('missing snapshot shows dashes', () => {
    expect(texts(view({ snapshot: null, cacheAt: null })).slice(0, 5)).toEqual(['5h —', 'wk —', 'ctx —', 'cache —', 'thread —'])
  })

  test('month loading and error', () => {
    expect(texts(view({ month: { usd: 0, isEstimate: false, status: 'loading' } }))).toContain('month …')
    expect(texts(view({ month: { usd: 0, isEstimate: false, status: 'error' } }))).toContain('month ?')
  })

  test('estimated month', () => {
    expect(texts(view({ month: { usd: 5, isEstimate: true, status: 'ready' } }))).toContain('month ~$5.00')
  })

  test('no projection, no burn segment', () => {
    expect(texts(view({ projection: null })).some(x => x.startsWith('limit'))).toBe(false)
  })

  test('every toggle off leaves nothing', () => {
    const off = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(k => [k, false])) as Settings
    expect(segments(view({ settings: off }))).toEqual([])
  })

  test('tones follow the 5h and context percentages', () => {
    const v = view({ snapshot: { fiveHour: { percentUsed: 95 }, context: { window: 1, percent: 72 } } })
    const tones = Object.fromEntries(segments(v).map(s => [s.key, s.tone]))
    expect(tones.fiveHour).toBe('danger')
    expect(tones.context).toBe('warn')
  })
})

describe('cache warmth', () => {
  const cache = (minutesAgo: number | null, settings: Partial<Settings> = {}) =>
    segments(view({ cacheAt: minutesAgo === null ? null : NOW - minutesAgo * MIN }, settings)).find(s => s.key === 'cache')

  test('just written', () => expect(cache(0)?.text).toBe('cache 60m'))
  test('counts down', () => {
    expect(cache(18)?.text).toBe('cache 42m')
    expect(cache(18)?.tone).toBeUndefined()
  })
  test('amber under ten minutes', () => {
    expect(cache(55)?.text).toBe('cache 5m')
    expect(cache(55)?.tone).toBe('warn')
  })
  test('cold after an hour', () => {
    expect(cache(61)?.text).toBe('cache cold')
    expect(cache(61)?.tone).toBe('danger')
  })
  test('no tone without threshold colors', () => expect(cache(61, { thresholdColors: false })?.tone).toBeUndefined())
  test('hidden when off', () => expect(cache(18, { cacheWarmth: false })).toBeUndefined())
})

describe('toneFor', () => {
  test('warn from 70', () => expect(toneFor(72, DEFAULT_SETTINGS)).toBe('warn'))
  test('danger from 90', () => expect(toneFor(95, DEFAULT_SETTINGS)).toBe('danger'))
  test('calm below 70', () => expect(toneFor(10, DEFAULT_SETTINGS)).toBeUndefined())
  test('off without threshold colors', () => {
    expect(toneFor(95, { ...DEFAULT_SETTINGS, thresholdColors: false })).toBeUndefined()
  })
})

describe('fit', () => {
  test('fit drops lowest priority first and keeps buttons', () => {
    const kept = fit(segments(view()), 110, 20).map(s => s.key)
    expect(kept).toEqual(['fiveHour', 'weekly', 'context', 'cache', 'thread'])
  })

  test('everything fits when wide', () => expect(fit(segments(view()), 200, 20)).toHaveLength(7))

  test('nothing fits at zero columns', () => expect(fit(segments(view()), 0, 20)).toEqual([]))
})
