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

/** How many helper agents the Agent Dock lets run at once. */
export type TeamSize = 1 | 3 | 5 | 10 | 20 | 30

/** Fast & Cheap helpers run on a smaller, quicker setup; Same as chat on the chat's model and effort. */
export type HelperMode = 'fast' | 'same'

/** One helper agent's card in the dock. */
export type AgentCard = {
  id: string
  task: string
  doing?: string
  percent?: number
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
}

/** The helpers started for the current request, and pieces waiting for a free one. */
export type AgentRun = { startedAt: number; cards: AgentCard[]; queued: string[]; isReported?: boolean }

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
      /** Whether the Agent Dock is open; closed, none of its settings apply. Not kept across sessions. */
      isDockOpen: boolean
      /** The dock's team size and helper model; mirrored in $.store. */
      team: TeamSize
      helpers: HelperMode
      /** The helpers of the current request; reset when the person sends a new one. */
      agentRun: AgentRun | null
      /** The chat's reasoning effort, as its last request sent it: what Same as chat helpers use. */
      mainEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number | null
      /** Bumped every second while helpers run, so their times redraw. */
      dockTick: number
    }
  }
}
