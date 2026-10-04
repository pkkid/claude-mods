import { describe, expect, test } from 'claude-code/testing'

import { clockTime, duration, tokens, usd, weeklyReset } from '../src/format'

const MIN = 60_000
const HOUR = 60 * MIN

describe('usd', () => {
  test('two decimals', () => expect(usd(3.124)).toBe('$3.12'))
  test('thousands separator', () => expect(usd(1234.5)).toBe('$1,234.50'))
  test('zero', () => expect(usd(0)).toBe('$0.00'))
  test('estimate prefix', () => expect(usd(3.1, true)).toBe('~$3.10'))
})

describe('tokens', () => {
  test('under a thousand', () => expect(tokens(950)).toBe('950'))
  test('thousands round', () => expect(tokens(62_400)).toBe('62k'))
  test('exact thousands', () => expect(tokens(200_000)).toBe('200k'))
  test('whole millions', () => expect(tokens(1_000_000)).toBe('1M'))
  test('fractional millions', () => expect(tokens(1_250_000)).toBe('1.3M'))
})

describe('duration', () => {
  test('under a minute', () => expect(duration(30_000)).toBe('<1m'))
  test('minutes', () => expect(duration(42 * MIN)).toBe('42m'))
  test('hours and minutes', () => expect(duration(72 * MIN)).toBe('1h12m'))
  test('days and hours', () => expect(duration(51 * HOUR)).toBe('2d3h'))
})

describe('weeklyReset', () => {
  test('hours when under a day', () => {
    const now = new Date(2026, 9, 4, 9, 0).getTime()
    expect(weeklyReset(new Date(now + 5 * HOUR).toISOString(), now)).toBe('5h')
  })

  test('weekday when a day or more away', () => {
    const now = new Date(2026, 9, 4, 9, 0).getTime() // Sunday
    const thursday = new Date(2026, 9, 8, 14, 0).toISOString()
    expect(weeklyReset(thursday, now)).toBe('Thu')
  })
})

describe('clockTime', () => {
  test('afternoon', () => expect(clockTime(new Date(2026, 9, 4, 15, 40).getTime())).toBe('3:40pm'))
  test('just after midnight', () => expect(clockTime(new Date(2026, 9, 4, 0, 5).getTime())).toBe('12:05am'))
})
