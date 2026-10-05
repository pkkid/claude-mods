import { describe, expect, test } from 'claude-code/testing'

import { percentText, segments, toneFor, usdPerWeeklyPercent } from '../src/bar'
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
      threadTokens: 1_250_000,
      lastTurnTokens: 48_200,
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
      '5h 42%, 1h12m',
      'wk 18%, Thu',
      'ctx 31% 62k/200k',
      'tok 1.3M (+48k)',
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
    const dashes = ['5h —', 'wk —', 'ctx —', 'tok —', 'cache —', 'thread —']
    expect(texts(view({ snapshot: null, cacheAt: null })).slice(0, 6)).toEqual(dashes)
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

describe('thread cost percent', () => {
  const HOUR = 60 * MIN
  // The weekly window resets Thursday 2pm, so it opened the Thursday before; $36 spent in it at 18% is $2 per 1%.
  const opened = new Date(2026, 9, 1, 14, 0).getTime()
  const hours = { [String(opened / HOUR)]: 30, [String(NOW / HOUR - 1)]: 6, [String(opened / HOUR - 30)]: 100 }
  const priced = (settings: Partial<Settings>) =>
    view(
      {
        snapshot: { ...view().snapshot, threadUsd: 3, lastTurnUsd: 0.5 },
        month: { usd: 184.2, isEstimate: false, status: 'ready', hours },
      },
      settings,
    )

  test('1% of the week costs this week\'s spend over its percent, from the window opening on', () => {
    expect(usdPerWeeklyPercent(priced({}).snapshot, priced({}).month)).toBe(2)
    expect(usdPerWeeklyPercent(view().snapshot, view().month)).toBeNull()
  })

  test('the thread and the last turn as shares of the week', () => {
    expect(texts(priced({}))).toContain('thread $3.00 (+$0.50) ~1.5% wk (+0.25%)')
  })

  test('the last turn alone, or the share alone, when the costs are off', () => {
    expect(texts(priced({ threadCost: false }))).toContain('last $0.50 ~0.25% wk')
    expect(texts(priced({ threadCost: false, lastTurnCost: false }))).toContain('thread ~1.5% wk')
  })

  test('off, or before the week can be priced, the costs show alone', () => {
    expect(texts(priced({ threadPercent: false }))).toContain('thread $3.00 (+$0.50)')
    expect(texts(view())).toContain('thread $3.12 (+$0.41)')
  })

  test('shares get the decimals small numbers need', () => {
    expect([percentText(12.4), percentText(2.14), percentText(0.044), percentText(0.004)]).toEqual([
      '12%',
      '2.1%',
      '0.04%',
      '<0.01%',
    ])
  })
})

describe('token segment', () => {
  test('the last turn alone when thread tokens are off; the thread alone when last-turn tokens are off', () => {
    expect(texts(view({}, { threadTokens: false }))).toContain('last tok 48k')
    expect(texts(view({}, { lastTurnTokens: false }))).toContain('tok 1.3M')
  })

  test('both off, no token segment', () => {
    expect(texts(view({}, { threadTokens: false, lastTurnTokens: false })).some(t => t.startsWith('tok'))).toBe(false)
  })
})
