import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_SETTINGS, TOGGLES, loadSettings, normalizeSettings, saveSettings } from '../src/settings'
import type { KeyStore } from '../src/settings'

function memoryStore(entries: Record<string, unknown> = {}): KeyStore {
  const data = new Map(Object.entries(entries))

  return {
    get: async key => data.get(key),
    set: async (key, value) => void data.set(key, JSON.parse(JSON.stringify(value))),
  }
}

describe('settings', () => {
  test('twelve toggles in spec order', () => {
    expect(TOGGLES).toHaveLength(12)
    expect(TOGGLES[0]?.key).toBe('fiveHour')
    expect(TOGGLES[11]?.key).toBe('handoffButton')
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
