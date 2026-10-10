export type ToggleKey =
  | 'label'
  | 'fiveHour'
  | 'weekly'
  | 'resets'
  | 'contextPercent'
  | 'contextTokens'
  | 'threadTokens'
  | 'lastTurnTokens'
  | 'cacheWarmth'
  | 'coldCost'
  | 'threadCost'
  | 'lastTurnCost'
  | 'threadPercent'
  | 'monthlyCost'
  | 'burnRate'
  | 'thresholdColors'
  | 'mascot'

export type Settings = Record<ToggleKey, boolean>

export type LimitWindow = { percentUsed: number; resetsAt?: string }

export type ContextFill = { tokens?: number; window: number; percent?: number }

export type Snapshot = {
  fiveHour?: LimitWindow
  weekly?: LimitWindow
  context?: ContextFill
  threadUsd?: number
  lastTurnUsd?: number
  /** Every token the thread's responses used this month, its helpers' included, from the transcript scan. */
  threadTokens?: number
  /** Every token the last main-thread turn used. */
  lastTurnTokens?: number
}

/** The handoff pane's content: the brief being written, the brief itself, or why there is none. */
export type Brief = { status: 'writing' | 'ready' | 'error'; text: string }

/** The note as read when the Notes pane opened, or why it could not be read; null while it loads. */
export type NotesFile = { text: string } | { error: string } | null

/** Which checklist view is on: Task View keeps the chat as is, Clean View hides tool calls and in-progress replies. */
export type ViewMode = 'off' | 'task' | 'clean'

/** One step; `percent` is the model's estimate of how far along a step in progress is (0 to 100). */
export type ChecklistItem = { text: string; status: 'todo' | 'doing' | 'done'; percent?: number }

/** The plan the model last reported through the checklist tool. */
export type Checklist = { title: string; items: ChecklistItem[] }

/** How many helper agents the Subagents pane lets run at once. */
export type TeamSize = 3 | 5 | 8 | 10 | 20

/** The team picked in the Subagents pane: a size, or Default, which leaves subagents as Claude Code runs them. */
export type TeamPick = TeamSize | 'default'

/** Fast & Cheap helpers run on a smaller, quicker setup; Same as chat on the chat's model and effort. */
export type HelperMode = 'fast' | 'same'

/**
 * Which subagents the pane lists: all of them, only those Claude started with its Agent tool (no workflow agents), or
 * only those started since the person's last prompt.
 */
export type AgentShowing = 'all' | 'tool' | 'current'

/** How long a finished subagent's line stays, in minutes: 0 hides it as soon as it finishes, `never` keeps it. */
export type HideAfter = 0 | 1 | 5 | 15 | 'never'

/**
 * Who a subagent line is for: a helper the team started (it reports its own progress), any other subagent, or one of
 * a workflow's agents (no name of its own: its workflow's, numbered).
 */
export type AgentKind = 'helper' | 'subagent' | 'workflow'

/** One subagent's line in the Subagents pane. */
export type AgentCard = {
  id: string
  task: string
  /** Absent on lines from before kinds existed: those were all helpers. */
  kind?: AgentKind
  doing?: string
  percent?: number
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
}

/** The subagents seen since the person's last request, and pieces waiting for a free helper. */
export type AgentRun = { startedAt: number; cards: AgentCard[]; queued: string[] }

/** What the mascot is doing; Celebrating, Oops and Waving play for a moment and give way. */
export type MascotPose = 'idle' | 'working' | 'reading' | 'puzzled' | 'sleeping' | 'celebrate' | 'error' | 'wave'

/**
 * The mascot's pose and what it changed from (its transition plays while `from` is set). `rest` is the pose a moment
 * pose gives way to; `change` counts pose changes and `seq` source changes; `since` is when the pose began.
 */
export type MascotState = {
  pose: MascotPose
  rest: MascotPose
  from: MascotPose | null
  change: number
  seq: number
  since: number
}

export type MonthTotal = {
  usd: number
  isEstimate: boolean
  status: 'loading' | 'ready' | 'error'
  /** Cost per hour (key: hours since the epoch) over the last 8 days, for the weekly window's total. */
  hours?: Record<string, number>
}

/** A worktree's CI at its commit: passed, failed, still running, or none found. */
export type CiState = 'pass' | 'fail' | 'running' | 'none'

/** A worktree branch's pull request on GitHub. */
export type WorktreePr = { number: number; url: string; state: 'open' | 'merged' | 'closed' }

/** One row of the Worktrees pane: what git and GitHub say of a worktree. */
export type Worktree = {
  path: string
  /** Null for a detached HEAD. */
  branch: string | null
  head: string
  /** The repository's main working tree: never removed. */
  isMain: boolean
  /** The worktree this session runs in: never removed. */
  isCurrent: boolean
  isLocked: boolean
  /** Its folder is gone; git still lists it until pruned. */
  isMissing: boolean
  /** Lines added and removed since it left the base branch, uncommitted work included. */
  added: number
  removed: number
  /** Changed, staged and untracked files. */
  changedFiles: number
  /** Commits on it the base branch lacks. */
  ahead: number
  /** Commits its remote branch lacks: all of `ahead` with no remote branch. */
  unpushed: number
  /** Nothing on it the base branch lacks, or its pull request merged at its commit. */
  isMerged: boolean
  /** The remote branch it tracks, while that exists. */
  remote: { name: string; branch: string } | null
  /** Its last commit (epoch ms). */
  committedAt: number | null
  pr: WorktreePr | null
  ci: CiState
}

/** The Worktrees pane's rows, read while it is open; `base` is the branch merges are measured against. */
export type WorktreeList =
  | { status: 'loading' }
  | { status: 'error'; text: string }
  | { status: 'ready'; base: string; worktrees: Worktree[] }

/** What a /keepwarm ping read and cost (priced at the chat's model; null for one with no known rates). */
export type PingReceipt = { at: number; read: number; usd: number | null; isEstimate: boolean }

/** /keepwarm's window: when it ends, and the last ping's receipt. */
export type KeepWarm = { until: number; lastPing: PingReceipt | null }

/** What a press in the Worktrees pane is about: Clean worktrees, or one row's delete. */
export type WorktreeTarget = { kind: 'clean' } | { kind: 'delete'; path: string }

/** A question the pane is asking, the removal under way, or what the last one did; null when none. */
export type WorktreeAction =
  | { step: 'ask' | 'busy'; target: WorktreeTarget }
  | { step: 'done'; text: string; isError: boolean }
  | null

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
      /** Whether the Subagents pane is open; closed, none of its settings apply. Not kept across sessions. */
      isDockOpen: boolean
      /** Whether the Notes pane is open, so a reload opens it again. Not kept across sessions. */
      isNotesOpen: boolean
      /** The note as read when the pane opened: the editor keeps its own text after that. */
      notes: NotesFile
      /** The dock's team size and helper model; mirrored in $.store. */
      team: TeamPick
      helpers: HelperMode
      /** The pane's Showing and Hide completed picks; mirrored in $.store. */
      agentShowing: AgentShowing
      hideAfter: HideAfter
      /** When the person last sent a prompt while the pane was open: where Current task agents start. */
      requestAt: number | null
      /** The helpers of the current request; reset when the person sends a new one. */
      agentRun: AgentRun | null
      /** The chat's reasoning effort, as its last request sent it: what Same as chat helpers use. */
      mainEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number | null
      /** Bumped every second while helpers run, so their times redraw. */
      dockTick: number
      /** What the mascot shows; a new session starts it waving. */
      mascot: MascotState
      /** How many AskUserQuestion dialogs are open: the mascot looks puzzled while any is. */
      asking: number
      /** Whether Claude's last reply ended by asking something; cleared by the person's next prompt. */
      isQuestionOpen: boolean
      /** Whether Claude's last reply asks something it never put as pop-up choices: the bar's ? button runs /askme. */
      isAskable: boolean
      /** The main chat's model, as its last request sent it: what a cold cache's cost is priced at. */
      mainModel: string | null
      /** /keepwarm's window while it runs; null while it is off. */
      keepWarm: KeepWarm | null
      /** Why /keepwarm last stopped before its time (a failed or cold ping); null when it ended on time or was turned off. */
      keepWarmStopped: string | null
      /** Whether the Worktrees pane is open, so a reload opens it again; git is only read while it is. */
      isWorktreesOpen: boolean
      /** The pane's rows; null until it first opens. */
      worktrees: WorktreeList | null
      /** The pane's question, removal under way, or last result. */
      worktreeAction: WorktreeAction
    }
  }
}
