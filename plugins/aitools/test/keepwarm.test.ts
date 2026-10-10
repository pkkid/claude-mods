import { describe, expect, test } from 'claude-code/testing'

import { CACHE_TTL } from '../src/bar'
import {
  KEEPWARM_DEFAULT_MS,
  KEEPWARM_LEAD_MS,
  coldPingText,
  failureText,
  isWarmReadback,
  keepWarmStatus,
  parseKeepWarm,
  pingDelay,
} from '../src/keepwarm'

const MIN = 60_000
const HOUR = 60 * MIN

describe('parseKeepWarm', () => {
  test('six hours bare; hours, minutes, both, and fractions', () => {
    expect(parseKeepWarm('')).toEqual({ kind: 'start', ms: KEEPWARM_DEFAULT_MS })
    expect(KEEPWARM_DEFAULT_MS).toBe(6 * HOUR)
    expect(parseKeepWarm('5h')).toEqual({ kind: 'start', ms: 5 * HOUR })
    expect(parseKeepWarm(' 90m ')).toEqual({ kind: 'start', ms: 90 * MIN })
    expect(parseKeepWarm('1h30m')).toEqual({ kind: 'start', ms: 90 * MIN })
    expect(parseKeepWarm('1h 30m')).toEqual({ kind: 'start', ms: 90 * MIN })
    expect(parseKeepWarm('2.5H')).toEqual({ kind: 'start', ms: 2.5 * HOUR })
  })

  test('off or stop ends it, status asks how it stands, help how to use it, anything else is refused', () => {
    expect(parseKeepWarm('off')).toEqual({ kind: 'stop' })
    expect(parseKeepWarm('stop')).toEqual({ kind: 'stop' })
    expect(parseKeepWarm('status')).toEqual({ kind: 'status' })
    expect(parseKeepWarm('help')).toEqual({ kind: 'help' })
    for (const bad of ['5', 'five hours', '0h', 'h', '5h10', '-1h', 'always']) {
      expect(parseKeepWarm(bad)).toBeNull()
    }
  })
})

describe('pingDelay', () => {
  const lapses = CACHE_TTL

  test('five minutes before the cache lapses, at least a second away', () => {
    expect(pingDelay(0, 0, 5 * HOUR)).toBe(lapses - KEEPWARM_LEAD_MS)
    expect(pingDelay(lapses - KEEPWARM_LEAD_MS + 1, 0, 5 * HOUR)).toBe(1000)
  })

  test('none before any request, once the cache has lapsed, or when it outlives keepwarm', () => {
    expect(pingDelay(0, null, 5 * HOUR)).toBeNull()
    expect(pingDelay(lapses, 0, 5 * HOUR)).toBeNull()
    expect(pingDelay(0, 0, lapses)).toBeNull()
  })
})

describe('ping readback', () => {
  test('warm when it read the prefix and wrote under a tenth of it', () => {
    expect(isWarmReadback({ cache_read_input_tokens: 75_000, cache_creation_input_tokens: 40 })).toBe(true)
    expect(isWarmReadback({ cache_read_input_tokens: 0, cache_creation_input_tokens: 75_000 })).toBe(false)
    expect(isWarmReadback({ cache_read_input_tokens: 75_000, cache_creation_input_tokens: 7_500 })).toBe(false)
  })

  test('says why it stopped', () => {
    expect(coldPingText({ cache_read_input_tokens: 0, cache_creation_input_tokens: 75_000 })).toBe(
      'the ping read 0 and wrote 75k tokens, so the cache had already lapsed',
    )
    expect(failureText('api-error', 529)).toBe('the API call failed (529)')
    expect(failureText('nothing-to-fork')).toBe('there is no conversation to warm yet')
    expect(failureText('aborted')).toBe('the ping was interrupted')
    expect(failureText('empty-reply')).toBe('the ping returned no text')
  })
})

describe('keepWarmStatus', () => {
  const now = new Date(2026, 9, 10, 12, 0).getTime()
  const kw = { until: now + 4 * HOUR + 12 * MIN, lastPing: null }

  test('time left, the next ping, and the last receipt', () => {
    expect(keepWarmStatus(kw, null, now - 20 * MIN, now)).toMatch(/^Keeping the cache warm for 4h12m more, until .+\. Next ping in 35m\. \/keepwarm off stops it\.$/)
    const pinged = { ...kw, lastPing: { at: now, read: 75_000, usd: 0.02, isEstimate: false } }
    expect(keepWarmStatus(pinged, null, now, now)).toContain('Last ping read 75k tokens, $0.02.')
  })

  test('waiting for a request, or for one after the cache went cold', () => {
    expect(keepWarmStatus(kw, null, null, now)).toContain('Waiting for the next request.')
    expect(keepWarmStatus(kw, null, now - 2 * HOUR, now)).toContain('The cache is cold now, so pings start after the next request.')
  })

  test('off, and why it stopped early', () => {
    expect(keepWarmStatus(null, null, null, now)).toMatch(/^Keepwarm is off\. \/keepwarm keeps/)
    expect(keepWarmStatus(null, 'the API call failed (529)', null, now)).toContain('It stopped early: the API call failed (529).')
  })
})
