import type { Settings, ToggleKey } from '../types'

/** The slice of `$.store` the mod needs; the hooks module passes `$.store` itself. */
export type KeyStore = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }

export const TOGGLES: readonly { key: ToggleKey; label: string }[] = [
  { key: 'label', label: 'AI Tools label' },
  { key: 'fiveHour', label: '5-hour usage' },
  { key: 'weekly', label: 'Weekly usage' },
  { key: 'resets', label: 'Reset countdowns' },
  { key: 'contextPercent', label: 'Context %' },
  { key: 'contextTokens', label: 'Context tokens' },
  { key: 'threadTokens', label: 'Thread tokens' },
  { key: 'lastTurnTokens', label: 'Last-turn tokens' },
  { key: 'cacheWarmth', label: 'Cache warmth' },
  { key: 'threadCost', label: 'Thread cost' },
  { key: 'lastTurnCost', label: 'Last-turn cost' },
  { key: 'threadPercent', label: 'Thread cost %' },
  { key: 'monthlyCost', label: 'Monthly cost' },
  { key: 'burnRate', label: 'Burn-rate projection' },
  { key: 'thresholdColors', label: 'Threshold colors' },
]

export const DEFAULT_SETTINGS: Settings = Object.fromEntries(TOGGLES.map(t => [t.key, true])) as Settings

export function normalizeSettings(raw: unknown): Settings {
  const given = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const settings = { ...DEFAULT_SETTINGS }
  for (const { key } of TOGGLES) {
    const value = given[key]
    if (typeof value === 'boolean') {
      settings[key] = value
    }
  }

  return settings
}

export async function loadSettings(store: KeyStore): Promise<Settings> {
  return normalizeSettings(await store.get('settings'))
}

export async function saveSettings(store: KeyStore, settings: Settings): Promise<void> {
  await store.set('settings', settings)
}

/** Whether `/aitools <args>` hides the bar: no argument toggles, on/show and off/hide set it; null for anything else. */
export function nextHidden(args: string, isHidden: boolean): boolean | null {
  const word = args.trim().toLowerCase()
  if (word === '') {
    return !isHidden
  }
  if (word === 'on' || word === 'show') {
    return false
  }
  if (word === 'off' || word === 'hide') {
    return true
  }

  return null
}
