export type ToggleKey =
  | 'fiveHour'
  | 'weekly'
  | 'resets'
  | 'contextPercent'
  | 'contextTokens'
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
      settings: Settings
      isSettingsOpen: boolean
      isHandingOff: boolean
    }
  }
}
