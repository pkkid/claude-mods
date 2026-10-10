import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_SETTINGS, TOGGLES, loadSettings, nextHidden, normalizeSettings, saveSettings } from '../src/settings'
import type { KeyStore } from '../src/settings'

function memoryStore(entries: Record<string, unknown> = {}): KeyStore {
  const data = new Map(Object.entries(entries))

  return {
    get: async key => data.get(key),
    set: async (key, value) => void data.set(key, JSON.parse(JSON.stringify(value))),
  }
}

describe('settings', () => {
  test('seventeen toggles in order, the mascot first and offered only where SVG draws', () => {
    expect(TOGGLES).toHaveLength(17)
    expect(TOGGLES[0]).toEqual({ key: 'mascot', label: 'Mascot', needsSvg: true })
    expect(TOGGLES[1]).toEqual({ key: 'label', label: 'Title' })
    expect(TOGGLES.filter(t => t.needsSvg)).toHaveLength(1)
    expect(TOGGLES[2]?.key).toBe('fiveHour')
    expect(TOGGLES[7]?.key).toBe('threadTokens')
    expect(TOGGLES[8]?.key).toBe('lastTurnTokens')
    expect(TOGGLES[9]?.key).toBe('cacheWarmth')
    expect(TOGGLES[10]).toEqual({ key: 'coldCost', label: 'Cold-cache cost' })
    expect(TOGGLES[13]?.key).toBe('threadPercent')
    expect(TOGGLES[16]?.key).toBe('thresholdColors')
  })

  test('all default to on', () => {
    expect(Object.values(DEFAULT_SETTINGS).every(Boolean)).toBe(true)
  })

  test('normalize undefined gives defaults', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  test('normalize keeps booleans and drops the rest', () => {
    const s = normalizeSettings({ weekly: false, bogus: 1, fiveHour: 'no' })
    expect(s.weekly).toBe(false)
    expect(s.fiveHour).toBe(true)
    expect(s).not.toHaveProperty('bogus')
  })

  test('load reads the store', async () => {
    const s = await loadSettings(memoryStore({ settings: { burnRate: false } }))
    expect(s.burnRate).toBe(false)
    expect(s.weekly).toBe(true)
  })

  test('save then load round-trips', async () => {
    const store = memoryStore()
    await saveSettings(store, { ...DEFAULT_SETTINGS, monthlyCost: false })
    expect((await loadSettings(store)).monthlyCost).toBe(false)
  })
})

describe('nextHidden', () => {
  test('no argument toggles', () => {
    expect(nextHidden('', false)).toBe(true)
    expect(nextHidden('  ', true)).toBe(false)
  })
  test('on and show reveal', () => {
    expect(nextHidden('on', true)).toBe(false)
    expect(nextHidden('Show', true)).toBe(false)
  })
  test('off and hide conceal', () => {
    expect(nextHidden('off', false)).toBe(true)
    expect(nextHidden(' HIDE ', false)).toBe(true)
  })
  test('anything else is null', () => expect(nextHidden('bogus', false)).toBeNull())
})
