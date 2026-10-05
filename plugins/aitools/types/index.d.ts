export type ToggleKey =
  | 'label'
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

/** The handoff pane's content: the brief being written, the brief itself, or why there is none. */
export type Brief = { status: 'writing' | 'ready' | 'error'; text: string }

/** Which checklist view is on: Task View keeps the chat as is, Clean View hides tool calls and in-progress replies. */
export type ViewMode = 'off' | 'task' | 'clean'

/** One step; `percent` is the model's estimate of how far along a step in progress is (0 to 100). */
export type ChecklistItem = { text: string; status: 'todo' | 'doing' | 'done'; percent?: number }

/** The plan the model last reported through the checklist tool. */
export type Checklist = { title: string; items: ChecklistItem[] }

export type MonthTotal = { usd: number; isEstimate: boolean; status: 'loading' | 'ready' | 'error' }

declare module 'claude-code' {
  interface PluginState {
    aitools: {
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
      /** The whole bar hidden by /aitools; mirrored in $.store so it holds across sessions. */
      isHidden: boolean
      isHandingOff: boolean
      /** Whether the 🛠 menu is showing its Handoff and Workflows options. */
      isToolsOpen: boolean
      /** What the handoff pane shows; null until the 🛠 menu's Handoff first runs. */
      brief: Brief | null
      /** Which checklist view is on; mirrored in $.store so it holds across sessions. */
      viewMode: ViewMode
      /** The checklist for the current request; cleared when the person sends a new one. */
      checklist: Checklist | null
      /** Final replies of finished turns: the only assistant text Clean View shows. */
      finals: string[]
    }
  }
}
