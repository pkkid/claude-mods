export type ToggleKey =
  | 'fiveHour'
  | 'weekly'
  | 'resets'
  | 'contextPercent'
  | 'contextTokens'
  | 'cacheWarmth'
  | 'threadCost'
  | 'lastTurnCost'
  | 'monthlyCost'
  | 'burnRate'
  | 'thresholdColors'
  | 'thresholdAlerts'
  | 'handoffButton'

export type Settings = Record<ToggleKey, boolean>

export type LimitWindow = { percentUsed: number; resetsAt?: string }

export type ContextFill = { tokens?: number; window: number; percent?: number }

export type Snapshot = {
  fiveHour?: LimitWindow
  weekly?: LimitWindow
  context?: ContextFill
  threadUsd?: number
  lastTurnUsd?: number
}

export type MonthTotal = { usd: number; isEstimate: boolean; status: 'loading' | 'ready' | 'error' }

declare module 'claude-code' {
  interface PluginState {
    aicost: {
      snapshot: Snapshot | null
      month: MonthTotal
      projection: number | null
      /** When the last main-thread model request started (epoch ms): the prompt cache's timer restarts then. */
      cacheAt: number | null
      /** Session cost when the running main-thread turn started: last-turn cost's baseline. */
      turnBaseline: { turnId: string; usd: number } | null
      /** Bumped every 30 s so countdowns redraw while idle. */
      tick: number
      settings: Settings
      isSettingsOpen: boolean
      /** The whole bar hidden by /aicost; mirrored in $.store so it holds across sessions. */
      isHidden: boolean
      isHandingOff: boolean
    }
  }
}
