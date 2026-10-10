import { atom, read, update } from 'claude-code'
import type { EngineInterface, Events, Register, Timer } from 'claude-code'

import {
  FAST_EFFORT,
  FAST_MODEL,
  HELPER_LABELS,
  HELPER_NOTE,
  PROGRESS_SPEC,
  PROGRESS_TOOL_ID,
  SUBAGENT_NOTE,
  DEFAULT_HIDE_AFTER,
  DOCK_PANE,
  activityText,
  addCard,
  dockNote,
  finishCard,
  isRunning,
  isHideAfter,
  isShowing,
  isTeamPick,
  newRun,
  noteActivity,
  queuePiece,
  renderDock,
  reportProgress,
  workflowName,
} from '../src/agentdock'
import { renderBar } from '../src/bar'
import {
  CHECKLIST_SPEC,
  CHECKLIST_TOOL_ID,
  VIEW_NAMES,
  FAINT_TEXT,
  addFinal,
  finalReplies,
  isFinalReply,
  nextView,
  parseChecklist,
  renderChecklist,
  viewNote,
} from '../src/checklist'
import { EMPTY_BURN, addSample, project } from '../src/burnrate'
import type { BurnState } from '../src/burnrate'
import { HANDOFF_PROMPT, handoffOutput, paneMarkdown } from '../src/handoff'
import { ASK_TOOL, askmeText, asksQuestions, isAskableIn } from '../src/askme'
import {
  MASCOT_START,
  ONE_SHOT_MS,
  READ_TOOLS,
  SLEEP_AFTER_MS,
  endsWithQuestion,
  introMs,
  isQuestionOpenIn,
  mascotDrawing,
} from '../src/mascot'
import {
  AFTER_TOOL_MS,
  BRANCH_FORMAT,
  CHANGING_TOOLS,
  GITHUB_EVERY,
  REFRESH_MS,
  SWEEP_MS,
  WORKTREES_PANE,
  countChanged,
  firstLine,
  isCleanable,
  isDeletable,
  parseBranchRefs,
  parsePrs,
  parseRuns,
  parseShortstat,
  parseWorktreeList,
  removedText,
  renderWorktrees,
  toWorktree,
  worktreeName,
} from '../src/worktrees'
import type { PrFacts, Removal, WorktreeFacts } from '../src/worktrees'
import { DEFAULT_SETTINGS, loadSettings, nextHidden, normalizeSettings, saveSettings } from '../src/settings'
import type { KeyStore } from '../src/settings'
import { scanMonth, sessionTokens, sessionUsd, usageTokens } from '../src/transcripts'
import type { ScanCache, ScanIO } from '../src/transcripts'
import type { CiState, Worktree, WorktreeTarget } from '../types'
import type { AgentKind, AgentShowing, Brief, HelperMode, HideAfter, LimitWindow, MascotPose, MascotState, Snapshot, TeamPick, TeamSize, ToggleKey, ViewMode } from '../types'

// The engine follows `$` only into functions declared in this file, so every
// function that touches `$` lives here; src/ holds the pure units.

const snapshot = atom({ plugin: 'aitools', key: 'snapshot' } as const, null)
const month = atom({ plugin: 'aitools', key: 'month' } as const, { usd: 0, isEstimate: false, status: 'loading' })
const projection = atom({ plugin: 'aitools', key: 'projection' } as const, null)
const settings = atom({ plugin: 'aitools', key: 'settings' } as const, DEFAULT_SETTINGS)
const isHidden = atom({ plugin: 'aitools', key: 'isHidden' } as const, false)
const isSettingsOpen = atom({ plugin: 'aitools', key: 'isSettingsOpen' } as const, false)
const cacheAt = atom({ plugin: 'aitools', key: 'cacheAt' } as const, null)
const turnBaseline = atom({ plugin: 'aitools', key: 'turnBaseline' } as const, null)
const tick = atom({ plugin: 'aitools', key: 'tick' } as const, 0)
const isHandingOff = atom({ plugin: 'aitools', key: 'isHandingOff' } as const, false)
const isToolsOpen = atom({ plugin: 'aitools', key: 'isToolsOpen' } as const, false)
const brief = atom({ plugin: 'aitools', key: 'brief' } as const, null)
const viewMode = atom({ plugin: 'aitools', key: 'viewMode' } as const, 'off')
const checklist = atom({ plugin: 'aitools', key: 'checklist' } as const, null)
const finals = atom({ plugin: 'aitools', key: 'finals' } as const, [])
const isDockOpen = atom({ plugin: 'aitools', key: 'isDockOpen' } as const, false)
const team = atom({ plugin: 'aitools', key: 'team' } as const, 'default' as TeamPick)
const helpers = atom({ plugin: 'aitools', key: 'helpers' } as const, 'same')
const agentShowing = atom({ plugin: 'aitools', key: 'agentShowing' } as const, 'all')
const hideAfter = atom({ plugin: 'aitools', key: 'hideAfter' } as const, DEFAULT_HIDE_AFTER)
const requestAt = atom({ plugin: 'aitools', key: 'requestAt' } as const, null)
const agentRun = atom({ plugin: 'aitools', key: 'agentRun' } as const, null)
const mainEffort = atom({ plugin: 'aitools', key: 'mainEffort' } as const, null)
const dockTick = atom({ plugin: 'aitools', key: 'dockTick' } as const, 0)
const mascot = atom({ plugin: 'aitools', key: 'mascot' } as const, MASCOT_START)
const asking = atom({ plugin: 'aitools', key: 'asking' } as const, 0)
const isQuestionOpen = atom({ plugin: 'aitools', key: 'isQuestionOpen' } as const, false)
const isAskable = atom({ plugin: 'aitools', key: 'isAskable' } as const, false)
const isNotesOpen = atom({ plugin: 'aitools', key: 'isNotesOpen' } as const, false)
const notes = atom({ plugin: 'aitools', key: 'notes' } as const, null)
const isWorktreesOpen = atom({ plugin: 'aitools', key: 'isWorktreesOpen' } as const, false)
const worktrees = atom({ plugin: 'aitools', key: 'worktrees' } as const, null)
const worktreeAction = atom({ plugin: 'aitools', key: 'worktreeAction' } as const, null)

const HANDOFF_PANE = 'handoff'
const NOTES_PANE = 'notes'
/** The note's file, under the session's project root. */
const NOTES_FILE = '.claude/notes.md'
/** The editor's key in the Notes pane. */
const NOTES_EDITOR = 'notes-editor'

/** Prompt origins that are the person's own words; anything else (a helper's report, a notice) is not a new request. */
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])
/** How many Subagents trace lines the store keeps. */
const TRACE_KEEP = 60
/** The mod's own tools: reporting progress is not work the mascot reacts to. */
const QUIET_TOOLS: ReadonlySet<string> = new Set([CHECKLIST_TOOL_ID, PROGRESS_TOOL_ID])
/** How long a helper's first model request waits for its own start to be recorded, at most. */
const SPAWN_WAIT_MS = 2000

/**
 * Subagents bookkeeping that must change without an `await` between check and write, so helpers started together
 * in one message see each other: the team places taken by starts still in flight, the helpers with a running card,
 * and the starts in flight, which a helper's first model request may wait on before its card exists.
 */
let reservedPlaces = 0
const liveHelpers = new Set<string>()
const startsInFlight = new Set<Promise<void>>()
/** Subagent loops already looked at: each gets a line once, or is passed over once (a fork, the pane closed). */
const seenAgents = new Set<string>()
/** Subagents with a line that shows their latest tool call (helpers report their own progress instead). */
const trackedAgents = new Set<string>()
/** The last workflow the main chat started, and how many of its agents have a line: what workflow agents are called. */
let lastWorkflow: string | null = null
let workflowAgents = 0
/** Read-only tool calls of the main chat in flight: the mascot reads until the last one returns. */
let readsInFlight = 0
/** Whether a main-chat turn is running: where the mascot stands when he is turned on mid-session. */
let isTurnRunning = false
/** Whether Claude has opened the question pop-up since the person's last prompt: then the bar offers no ? button. */
let isAskedThisRequest = false
/** The once-a-second timer that redraws helper times: running only while the Subagents pane is open. */
let dockTimer: Timer | null = null
/** The model tools registered so far: each is offered to the model only once its feature is first turned on. */
const registeredTools = new Set<string>()
/** The note's writes, one after another, so the last text typed is the one left on disk. */
let notesSaving: Promise<void> = Promise.resolve()
/** The note as it stands: as loaded, then as the editor last posted it. What Copy copies. */
let latestNotes = ''
/** Trace writes run one after another, so lines written at once are all kept. */
let traceQueue: Promise<void> = Promise.resolve()
/** The Worktrees pane's timers: its regular read, and the one a changing tool sets. Running only while it is open. */
let worktreeTimer: Timer | null = null
let worktreeSoon: Timer | null = null
/** Reads of the pane so far since it opened: every GITHUB_EVERY-th asks GitHub too. */
let worktreeReads = 0
/** The read in flight, and whether another (with GitHub's or not) waits for it to finish. */
let worktreeReading: Promise<void> | null = null
let worktreeQueued: { withGithub: boolean } | null = null
/** The branch merges are measured against, found once each time the pane opens. */
let worktreeBase: string | null = null
/** GitHub's word, as last read: pull requests by branch and CI by commit. Dropped when the pane closes. */
let githubPrs = new Map<string, PrFacts[]>()
let githubRuns = new Map<string, CiState>()

const encoder = new TextEncoder()
const TICK_MS = 30_000
/** Cache times older than this are dropped from the per-session store. */
const CACHE_KEEP_MS = 2 * 60 * 60_000
/** Blank rows between the chat and the bar on the terminal, so the last of a reply does not run into it. */
const TERMINAL_TOP_MARGIN = 1

/** The latest scan, kept here too so a store write that fails costs nothing but persistence. */
let memoryCache: ScanCache | null = null
let isScanning = false
let isScanPending = false
let hasLoggedScanError = false

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Whether a bar option is on and the bar shown: work that only feeds the bar is skipped otherwise. */
async function isShown($: EngineInterface, keys: ToggleKey | readonly ToggleKey[]): Promise<boolean> {
  if (await read($, isHidden)) {
    return false
  }
  const current = normalizeSettings(await read($, settings))

  return (typeof keys === 'string' ? [keys] : keys).some(key => current[key])
}

/** The options whose figures come from the transcript scan: the month's cost, the thread's tokens, the week's share. */
const SCAN_KEYS: readonly ToggleKey[] = ['monthlyCost', 'threadTokens', 'threadPercent']
/** The options that show the session's cost. */
const COST_KEYS: readonly ToggleKey[] = ['threadCost', 'lastTurnCost', 'threadPercent']

/** Whether the mascot is drawn anywhere: its option on, the bar shown, and a surface that draws SVG attached. */
async function isMascotOn($: EngineInterface): Promise<boolean> {
  if (!(await isShown($, 'mascot'))) {
    return false
  }

  return (await $.session.surfaces().catch(() => [])).some(surface => surface !== 'terminal')
}

/** Offers one of the mod's tools to the model, the first time its feature is turned on in this load. */
async function registerTool($: EngineInterface, spec: Parameters<EngineInterface['tool']['register']>[0]): Promise<void> {
  if (registeredTools.has(spec.name)) {
    return
  }
  registeredTools.add(spec.name)
  await $.tool.register(spec).catch(err => {
    registeredTools.delete(spec.name)
    $.ui.log(`aitools: ${spec.name} tool not registered: ${errorText(err)}`)
  })
}

function toWindow(limit: { percentUsed: number; resetsAt?: string } | undefined): LimitWindow | undefined {
  return limit && { percentUsed: limit.percentUsed, resetsAt: limit.resetsAt }
}

function storeOf($: EngineInterface): KeyStore {
  return { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) }
}

function scanIO($: EngineInterface): ScanIO {
  return {
    list: dir => $.fs.list(dir),
    readBytes: async path => encoder.encode(await $.fs.read(path)),
    async tail(path, offset) {
      const run = await $.process.run(['tail', '-c', `+${offset + 1}`, path])
      if (run.exitCode !== 0) {
        throw new Error(`tail exited ${run.exitCode}`)
      }

      return { bytes: encoder.encode(run.stdout), isTruncated: run.isStdoutTruncated }
    },
  }
}

async function projectsRoot($: EngineInterface): Promise<string> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')

  return `${configDir ?? `${home}/.claude`}/projects`
}

async function readCache($: EngineInterface): Promise<ScanCache | null> {
  return memoryCache ?? ((await $.store.get('scanCache')) as ScanCache | undefined) ?? null
}

async function scan($: EngineInterface): Promise<void> {
  if (isScanning) {
    isScanPending = true
    return
  }
  isScanning = true
  try {
    do {
      isScanPending = false
      const next = await scanMonth(scanIO($), await projectsRoot($), await readCache($), await $.clock.now())
      memoryCache = next
      await $.store.set('scanCache', next).catch((err: unknown) => logScanError($, err))
      await update($, month, () => ({ usd: next.usd, isEstimate: next.isEstimate, status: 'ready' as const, hours: next.hours }))
      const threadTokens = sessionTokens(next, await $.session.id())
      if (threadTokens !== undefined) {
        await update($, snapshot, snap => ({ ...(snap ?? {}), threadTokens }))
      }
    } while (isScanPending)
  } catch (err) {
    await update($, month, m => ({ ...m, usd: m?.usd ?? 0, isEstimate: m?.isEstimate ?? false, status: 'error' as const }))
    logScanError($, err)
  } finally {
    isScanning = false
  }
}

function logScanError($: EngineInterface, err: unknown): void {
  if (!hasLoggedScanError) {
    hasLoggedScanError = true
    $.ui.log(`aitools: monthly cost scan failed: ${errorText(err)}`)
  }
}

type CacheTimes = Record<string, number>

async function rememberCacheAt($: EngineInterface, at: number): Promise<void> {
  const sessionId = await $.session.id()
  const stored = ((await $.store.get('cacheAt')) as CacheTimes | undefined) ?? {}
  const kept = Object.fromEntries(Object.entries(stored).filter(([, t]) => at - t < CACHE_KEEP_MS))
  await $.store.set('cacheAt', { ...kept, [sessionId]: at })
}

async function restoreCacheAt($: EngineInterface): Promise<void> {
  const stored = ((await $.store.get('cacheAt')) as CacheTimes | undefined) ?? {}
  const at = stored[await $.session.id()]
  if (at !== undefined) {
    await update($, cacheAt, () => at)
  }
}

/** Scans the transcripts soon, if any option showing their figures is on. */
function startScan($: EngineInterface): void {
  $.clock.after(0, () => void scanIfShown($))
}

async function scanIfShown($: EngineInterface): Promise<void> {
  if (await isShown($, SCAN_KEYS)) {
    await scan($)
  }
}

/** Asks a fork of this conversation for the brief: the brief, or the failure's text. Null while one is already running. */
async function writeBrief($: EngineInterface): Promise<Brief | null> {
  if (await read($, isHandingOff)) {
    return null
  }
  await update($, isHandingOff, () => true)
  try {
    const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!reply.isAnswered) {
      const reason = reply.reason === 'nothing-to-fork' ? 'nothing to hand off yet' : reply.reason
      return { status: 'error', text: `Handoff failed: ${reason}` }
    }

    return { status: 'ready', text: reply.text.trim() }
  } catch (err) {
    return { status: 'error', text: `Handoff failed: ${errorText(err)}` }
  } finally {
    await update($, isHandingOff, () => false)
  }
}

/** /handoff: copies the brief and toasts the outcome. Returns the chat row's text. */
async function handoff($: EngineInterface): Promise<string> {
  const written = await writeBrief($)
  if (written === null) {
    return 'Handoff already in progress.'
  }
  if (written.status === 'error') {
    $.ui.toast(written.text)
    return written.text
  }
  const copied = await $.ui.copy({ text: written.text })
  $.ui.toast(copied.isCopied ? 'Handoff brief copied to the clipboard' : 'Handoff brief ready (copy failed)')

  return handoffOutput(written.text)
}

/** Where the note is kept: `.claude/notes.md` under the session's project root. */
async function notesPath($: EngineInterface): Promise<string> {
  return `${(await $.session.root()).replace(/[\\/]$/, '')}/${NOTES_FILE}`
}

/**
 * Reads the note for the pane, once any write still going has landed: none yet is an empty note; a file that is there
 * but cannot be read is an error, so the editor never writes over it.
 */
async function loadNotes($: EngineInterface): Promise<void> {
  await update($, notes, () => null)
  await notesSaving
  const path = await notesPath($)
  let loaded: { text: string } | { error: string }
  if (!(await $.fs.exists(path).catch(() => false))) {
    loaded = { text: '' }
  } else {
    loaded = await $.fs.read(path).then(
      text => (typeof text === 'string' ? { text } : { error: `${NOTES_FILE} is not text.` }),
      (err: unknown) => ({ error: `Could not read ${NOTES_FILE}: ${errorText(err)}` }),
    )
  }
  latestNotes = 'text' in loaded ? loaded.text : ''
  await update($, notes, () => loaded)
}

/** The 🛠 menu's Notes: opens the Notes pane on the note as saved, its keys handed to the editor. */
async function openNotes($: EngineInterface): Promise<void> {
  await update($, isToolsOpen, () => false)
  await update($, isNotesOpen, () => true)
  await $.ui.open({ id: NOTES_PANE, title: 'Notes', focus: true })
  await loadNotes($)
  await $.ui.focus({ requestId: NOTES_PANE, key: NOTES_EDITOR }).catch(() => undefined)
}

/** Saves the note as the editor posted it, after any write before it. */
function saveNotes($: EngineInterface, text: string): void {
  latestNotes = text
  notesSaving = notesSaving
    .then(async () => $.fs.write(await notesPath($), text))
    .catch((err: unknown) => $.ui.log(`aitools: could not save ${NOTES_FILE}: ${errorText(err)}`))
}

/** The Notes pane's Copy: the note as it stands, to the clipboard of the surface pressed on. */
async function copyNotes($: EngineInterface, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']): Promise<void> {
  const copied = await $.ui.copy({ text: latestNotes, surface })
  $.ui.toast(copied.isCopied ? 'Note copied to the clipboard' : 'Copy failed')
}

/** The 🛠 menu's Handoff: writes the brief into the handoff pane, which has its own Copy button. */
async function showHandoff($: EngineInterface): Promise<void> {
  await update($, isToolsOpen, () => false)
  if (await read($, isHandingOff)) {
    $.ui.toast('Handoff already in progress.')
    return
  }
  await update($, brief, () => ({ status: 'writing', text: '' }))
  await $.ui.open({ id: HANDOFF_PANE, title: 'Handoff brief' })
  const written = await writeBrief($)
  if (written !== null) {
    await update($, brief, () => written)
  }
}

/** Copies the handoff pane's brief on the surface the press came from, and says whether it took. */
async function copyBrief($: EngineInterface, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']): Promise<void> {
  const shown = await read($, brief)
  if (shown?.status !== 'ready') {
    return
  }
  const copied = await $.ui.copy({ text: shown.text, surface })
  $.ui.toast(copied.isCopied ? 'Handoff brief copied to the clipboard' : 'Copy failed')
}

async function toggleSetting($: EngineInterface, key: keyof typeof DEFAULT_SETTINGS): Promise<void> {
  const changed = await update($, settings, s => {
    const was = normalizeSettings(s)

    return { ...was, [key]: !was[key] }
  })
  await saveSettings(storeOf($), normalizeSettings(changed))
  if (normalizeSettings(changed)[key]) {
    await catchUp($, key)
  }
}

/**
 * Brings a feature up to date once it is turned on, or the whole bar once it is shown again (`key` absent): the work
 * skipped while it was off.
 */
async function catchUp($: EngineInterface, key?: ToggleKey): Promise<void> {
  startScan($)
  if ((key === undefined || COST_KEYS.includes(key)) && (await isShown($, COST_KEYS))) {
    const cost = (await $.session.usage()).cost?.usd
    if (cost !== undefined) {
      await update($, snapshot, snap => ({ ...(snap ?? {}), threadUsd: cost }))
    }
  }
  if (key === 'cacheWarmth') {
    // Its time was not kept while it was off: unknown until the next request.
    await update($, cacheAt, () => null)
  }
  if ((key === undefined || key === 'mascot') && (await isMascotOn($))) {
    await syncMascot($)
  }
}
/** The 🛠 menu's Task View and Clean View: sets the view, saves it for later sessions and closes the menu. */
async function setView($: EngineInterface, mode: ViewMode): Promise<void> {
  await update($, isToolsOpen, () => false)
  await update($, viewMode, () => mode)
  await $.store.set('viewMode', mode)
  await showStatus($)
  await startView($, mode)
}

/**
 * What a view needs once it is on: the checklist tool offered to the model, and for Clean View the final replies so
 * far (only kept while it is on).
 */
async function startView($: EngineInterface, mode: ViewMode): Promise<void> {
  if (mode === 'off') {
    return
  }
  await registerTool($, CHECKLIST_SPEC)
  if (mode === 'clean') {
    const earlier = finalReplies(await $.session.messages().catch(() => []))
    await update($, finals, list => earlier.reduce((acc, text) => addFinal(acc, text), list))
  }
}

/**
 * The status line under the prompt: the view that is on and Subagents while a team is picked, comma separated; cleared
 * when none. A Subagents pane open but not on screen (waiting for room) applies nothing, and says so; on Default the
 * pane changes nothing, so the line leaves it out.
 */
async function showStatus($: EngineInterface): Promise<void> {
  const mode = await read($, viewMode)
  const parts: string[] = mode === 'off' ? [] : [VIEW_NAMES[mode]]
  if (await isTeamPicked($)) {
    const pane = (await $.ui.panes()).find(p => p.id === DOCK_PANE)
    parts.push(pane?.isPlaced === false ? 'Subagents (not shown)' : 'Subagents')
  }
  $.ui.status(parts.length > 0 ? parts.join(', ') : undefined)
}

/** /taskview and /cleanview: toggles the view, or sets it with on/off, and says what is on now. */
async function viewCommand($: EngineInterface, view: 'task' | 'clean', args: string): Promise<{ text: string }> {
  const name = VIEW_NAMES[view]
  const mode = nextView(await read($, viewMode), view, args)
  if (mode === null) {
    return { text: `Usage: /${view}view [on|off] (no argument toggles ${name})` }
  }
  await setView($, mode)

  return { text: mode === 'off' ? `${name} off.` : `${VIEW_NAMES[mode]} on.` }
}

/** Redraws the dock's running times each second; with nothing running any more, the timer stops. */
async function bumpDockTick($: EngineInterface): Promise<void> {
  if (isRunning(await read($, agentRun))) {
    await update($, dockTick, n => n + 1)
  } else {
    dockTimer?.cancel()
    dockTimer = null
  }
}

/** Starts the once-a-second redraw while the pane is open and a subagent runs; it stops itself once none does. */
async function startDockTimer($: EngineInterface): Promise<void> {
  if (dockTimer === null && (await read($, isDockOpen)) && isRunning(await read($, agentRun))) {
    dockTimer = $.clock.every(1000, () => void bumpDockTick($))
  }
}

/** Opens or closes the Subagents pane; closed, none of its settings apply. */
async function setDockOpen($: EngineInterface, isOpen: boolean): Promise<void> {
  await update($, isDockOpen, () => isOpen)
  if (isOpen) {
    await $.ui.open({ id: DOCK_PANE, title: 'Subagents' })
  } else {
    await $.ui.close({ id: DOCK_PANE })
  }
  await syncDock($)
  await showStatus($)
}

/** Whether the Subagents pane is open with a team size picked: on Default, or closed, it changes nothing. */
async function isTeamPicked($: EngineInterface): Promise<boolean> {
  return (await read($, isDockOpen)) && (await read($, team)) !== 'default'
}

/**
 * Runs the pane's work only while it is open: its once-a-second redraw timer while a subagent runs, and the progress
 * tool its subagents report through.
 */
async function syncDock($: EngineInterface): Promise<void> {
  if (!(await read($, isDockOpen))) {
    dockTimer?.cancel()
    dockTimer = null
    return
  }
  await startDockTimer($)
  await registerTool($, PROGRESS_SPEC)
}

/**
 * The team size in effect: the pane is open with a size picked and on screen; null otherwise. A pane that went away
 * turns it off; one open but not on screen applies nothing, which the status line says.
 */
async function activeTeam($: EngineInterface): Promise<TeamSize | null> {
  if (!(await read($, isDockOpen))) {
    return null
  }
  const pane = (await $.ui.panes()).find(p => p.id === DOCK_PANE)
  if (pane === undefined) {
    await update($, isDockOpen, () => false)
    await syncDock($)
  }
  await showStatus($)
  const pick = await read($, team)

  return pick === 'default' || pane?.isPlaced !== true ? null : pick
}

/** /subagents: opens the pane if closed, closes it if open. */
async function toggleDock($: EngineInterface): Promise<boolean> {
  const isOpen = !(await read($, isDockOpen))
  await setDockOpen($, isOpen)

  return isOpen
}

/** The 🛠 menu's Subagents: opens the pane (its own close mark closes it), and closes the menu. */
async function openDock($: EngineInterface): Promise<void> {
  await update($, isToolsOpen, () => false)
  await setDockOpen($, true)
}

/** The pane's team pick, saved for later sessions; Default stops its work, a size starts it. */
async function setTeam($: EngineInterface, pick: TeamPick): Promise<void> {
  await update($, team, () => pick)
  await $.store.set('agentTeam', pick)
  await syncDock($)
  await showStatus($)
}

/** The dock's helper model, saved for later sessions. */
async function setHelpers($: EngineInterface, mode: HelperMode): Promise<void> {
  await update($, helpers, () => mode)
  await $.store.set('agentHelpers', mode)
}

/** The pane's Showing pick, saved for later sessions. */
async function setShowing($: EngineInterface, showing: AgentShowing): Promise<void> {
  await update($, agentShowing, () => showing)
  await $.store.set('agentShowing', showing)
}

/** The pane's Hide completed pick, saved for later sessions. */
async function setHideAfter($: EngineInterface, minutes: HideAfter): Promise<void> {
  await update($, hideAfter, () => minutes)
  await $.store.set('agentHideAfter', minutes)
}

/** Appends one line to the Subagents pane trace in the store, the newest TRACE_KEEP kept, one write after another. */
function traceDock($: EngineInterface, line: string): Promise<void> {
  traceQueue = traceQueue.then(() => appendTrace($, line)).catch(() => undefined)

  return traceQueue
}

/** Reads the trace, adds one timed line and writes it back; only ever run through traceDock's queue. */
async function appendTrace($: EngineInterface, line: string): Promise<void> {
  const at = new Date(await $.clock.now()).toISOString().slice(11, 19)
  const trace = ((await $.store.get('dockTrace')) as string[] | undefined) ?? []
  await $.store.set('dockTrace', [...trace, `${at} ${line}`].slice(-TRACE_KEEP))
}

/** Waits for `work`, or `ms` at most, whichever comes first. */
function waitAtMost($: EngineInterface, work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise(resolve => {
    $.clock.after(ms, () => resolve())
    void work.then(() => resolve(), () => resolve())
  })
}

/**
 * Marks a subagent finished: a helper's place on the team frees up, and its line turns done or failed and moves down
 * to the top of the finished ones.
 */
async function endHelper($: EngineInterface, id: string, isAnswered: boolean): Promise<void> {
  liveHelpers.delete(id)
  trackedAgents.delete(id)
  const now = await $.clock.now()
  await update($, agentRun, run => (run === null ? run : finishCard(run, id, isAnswered, now)))
}

/** Gives a subagent a line in the pane, once, while it is open; `kind` says how its line follows it. */
async function trackAgent($: EngineInterface, id: string, task: string, kind: AgentKind): Promise<void> {
  seenAgents.add(id)
  if (kind !== 'helper') {
    trackedAgents.add(id)
  }
  const now = await $.clock.now()
  await update($, agentRun, r => addCard(r ?? newRun(now), id, task, now, kind))
  await startDockTimer($)
}

/**
 * A subagent loop the pane has no line for yet, at its first model request: one the engine lists (started before the
 * pane opened, or by another plugin) gets its own description; one it does not list is a workflow's agent while a
 * workflow has been started, else the engine's own fork, which is passed over.
 */
async function noticeAgent($: EngineInterface, id: string): Promise<void> {
  seenAgents.add(id)
  if (!(await read($, isDockOpen)) || (await read($, isHandingOff))) {
    return
  }
  const listed = (await $.agent.list().catch(() => [])).find(a => a.id === id)
  if (listed !== undefined) {
    await trackAgent($, id, listed.description, 'subagent')
  } else if (lastWorkflow !== null) {
    workflowAgents += 1
    await trackAgent($, id, `${lastWorkflow} · agent ${workflowAgents}`, 'workflow')
  }
}

/** Marks done or failed any card whose helper the engine no longer has running, in case its finish was never heard. */
async function settleCards($: EngineInterface): Promise<void> {
  const run = await read($, agentRun)
  if (!isRunning(run)) {
    return
  }
  const agents = await $.agent.list().catch(() => null)
  if (agents === null) {
    return
  }
  // A helper the engine no longer lists has finished too; only one listed as running or pending is still at work. A
  // workflow's agents are never listed: their own finish is the only word on them.
  for (const card of run?.cards.filter(c => c.status === 'running' && c.kind !== 'workflow') ?? []) {
    const status = agents.find(a => a.id === card.id)?.status ?? 'gone'
    if (status !== 'running' && status !== 'pending') {
      await traceDock($, `settled ${card.task}: ${status}`)
      await endHelper($, card.id, status !== 'failed' && status !== 'killed')
    }
  }
}


/**
 * Starts a subagent the team does not run: as Claude Code would, given a line in the pane while it is open and asked
 * to report its progress there. Its start counts as in flight, so its first request finds the line rather than racing
 * it.
 */
async function startSubagent(
  $: EngineInterface,
  e: Parameters<Events['agent.spawn']>[1],
  next: Parameters<Events['agent.spawn']>[2],
): Promise<Awaited<ReturnType<Events['agent.spawn']>>> {
  if (!(await read($, isDockOpen))) {
    return next(e)
  }
  if (await isTeamPicked($)) await traceDock($, `ignored ${e.description}: not a team helper`)
  let settle = () => {}
  const inFlight = new Promise<void>(resolve => (settle = resolve))
  startsInFlight.add(inFlight)
  try {
    const started = await next({ ...e, prompt: e.prompt + SUBAGENT_NOTE })
    if (started.agentId !== undefined) {
      await trackAgent($, started.agentId, e.description, 'subagent')
    }

    return started
  } finally {
    startsInFlight.delete(inFlight)
    settle()
  }
}

/**
 * Shows `pose`, playing its transition from the pose before first; `rest` is the pose a moment pose (ONE_SHOT_MS)
 * gives way to. Showing the pose already up only changes what it gives way to.
 */
async function showMascot($: EngineInterface, pose: MascotPose, rest: MascotPose = pose): Promise<void> {
  if (!(await isMascotOn($))) {
    return
  }
  const now = await $.clock.now()
  // Checked inside the update, so two calls at once (parallel tool calls) change the pose once.
  let isChanged = false
  const shown = await update($, mascot, m => {
    isChanged = m.pose !== pose
    return isChanged ? { pose, rest, from: m.pose, change: m.change + 1, seq: m.seq + 1, since: now } : { ...m, rest }
  })
  if (!isChanged) {
    return
  }
  const { change } = shown
  // Once the intro has played the source drops it, so a redraw can only ever restart the loop.
  $.clock.after(introMs(pose, shown.from), () => void settleMascot($, change))
  const hold = ONE_SHOT_MS[pose]
  if (hold !== undefined) {
    $.clock.after(hold, () => void endMoment($, change))
  }
}

/** Drops the played intro from the mascot's source, unless the pose changed since. */
async function settleMascot($: EngineInterface, change: number): Promise<void> {
  await update($, mascot, m => (m.change === change && m.from !== null ? { ...m, from: null, seq: m.seq + 1 } : m))
}

/** A moment pose that is still up gives way to the pose underneath it. */
async function endMoment($: EngineInterface, change: number): Promise<void> {
  const shown = await read($, mascot)
  if (shown.change === change) {
    await showMascot($, shown.rest)
  }
}

/** The pose underneath when no turn runs: puzzled while a question waits on the person, standing otherwise. */
async function restingPose($: EngineInterface): Promise<MascotPose> {
  return (await read($, asking)) > 0 || (await read($, isQuestionOpen)) ? 'puzzled' : 'idle'
}

/**
 * Where the mascot should be when he is turned on: his poses were not followed while he was off, so the question
 * left open is read back from the conversation.
 */
async function syncMascot($: EngineInterface): Promise<void> {
  const isAsked = isQuestionOpenIn(await $.session.messages().catch(() => []))
  await update($, isQuestionOpen, () => isAsked)
  await showMascot($, isTurnRunning ? 'working' : await restingPose($))
}

/** Standing idle long enough, the mascot sits down and falls asleep; the person's next prompt wakes him. */
async function checkSleep($: EngineInterface): Promise<void> {
  const shown = await read($, mascot)
  if (shown.pose === 'idle' && (await $.clock.now()) - shown.since >= SLEEP_AFTER_MS && (await isMascotOn($))) {
    await showMascot($, 'sleeping')
  }
}

/** Draws nothing in a transcript row's place: how Clean View hides tool calls and in-progress replies. */
function drawNothing($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0]) {
  const { Box } = $.ui.resolve(e)

  return <Box key="aitools-hidden" display="none" />
}

/** Opens or closes one menu above the bar; opening it closes the other, so only one row shows. */
async function toggleMenu($: EngineInterface, menu: 'tools' | 'settings'): Promise<void> {
  if (menu === 'tools') {
    if (await update($, isToolsOpen, open => !open)) {
      await update($, isSettingsOpen, () => false)
    }
  } else if (await update($, isSettingsOpen, open => !open)) {
    await update($, isToolsOpen, () => false)
  }
}

/** Every 30 s: countdowns redraw while the bar shows; the mascot may fall asleep. */
async function onTick($: EngineInterface): Promise<void> {
  if (!(await read($, isHidden))) {
    await update($, tick, n => (n ?? 0) + 1)
  }
  await checkSleep($)
}

/** The mascot drawing last built: it only changes with the pose, so redraws of the bar reuse it. */
let lastMascot: { state: MascotState; drawing: ReturnType<typeof mascotDrawing> } | null = null

function drawMascot(state: MascotState): ReturnType<typeof mascotDrawing> {
  if (lastMascot?.state.pose !== state.pose || lastMascot.state.from !== state.from || lastMascot.state.seq !== state.seq) {
    lastMascot = { state, drawing: mascotDrawing(state) }
  }

  return lastMascot.drawing
}

/**
 * The bar's ? button: /askme's prompt sent as the person's, or, while a turn runs or when the prompt cannot be sent,
 * `/askme` put in the prompt box ahead of any draft (which then rides along as its note) to send by hand. When the box
 * cannot take it either, the button stays.
 */
async function askFromBar($: EngineInterface, isWorking: boolean): Promise<void> {
  await update($, isAskable, () => false)
  if (!isWorking) {
    const sent = await $.prompt.submit({ text: askmeText(''), asUser: true }).catch(() => null)
    if (sent !== null && sent.drop === undefined) {
      return
    }
  }
  const draft = (await $.prompt.read()).text.trim()
  const filled = await $.prompt.fill({ text: draft === '' ? '/askme' : `/askme ${draft}` }).catch(() => null)
  if (!filled?.isFilled) {
    await update($, isAskable, () => true)
  }
}

/** The bar, with the 🛠 or ⁝ menu above it while one is open, for the AbovePrompt band. */
async function drawBar($: EngineInterface, el: Parameters<typeof renderBar>[0], isWorking: boolean) {
  await read($, tick)
  const current = normalizeSettings(await read($, settings))

  const view = {
    snapshot: await read($, snapshot),
    month: await read($, month),
    projection: await read($, projection),
    cacheAt: await read($, cacheAt),
    settings: current,
    now: await $.clock.now(),
  }
  const flags = {
    isWorking,
    isHandingOff: await read($, isHandingOff),
    isToolsOpen: await read($, isToolsOpen),
    isSettingsOpen: await read($, isSettingsOpen),
    isAskable: await read($, isAskable),
    viewMode: await read($, viewMode),
    // Read only where it is drawn and turned on, so no other bar redraws for the mascot.
    mascot: el.Svg && current.mascot ? drawMascot(await read($, mascot)) : null,
  }
  const list =
    flags.viewMode === 'off'
      ? null
      : renderChecklist(el, await read($, checklist), isWorking, () => void update($, checklist, () => null))

  return renderBar(el, view, flags, {
    toggleTools: () => void toggleMenu($, 'tools'),
    askme: () => void askFromBar($, isWorking),
    handoff: () => void showHandoff($),
    openNotes: () => void openNotes($),
    toggleSettings: () => void toggleMenu($, 'settings'),
    setView: mode => void setView($, mode),
    openDock: () => void openDock($),
    openWorktrees: () => void openWorktrees($),
    toggle: key => void toggleSetting($, key),
  }, list)
}

async function measure($: EngineInterface, e: { rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]; context: Snapshot['context'] & {}; cost?: { usd: number } }) {
  const previous = await read($, snapshot)
  // Off the subscription's ledger, the session's cost comes from the last scan, if a cost is shown at all.
  const cache = e.cost || !(await isShown($, COST_KEYS)) ? null : await readCache($)
  const fallback = cache ? sessionUsd(cache, await $.session.id()) : undefined
  const snap: Snapshot = {
    fiveHour: toWindow(e.rateLimits.find(r => r.kind === 'five_hour')) ?? previous?.fiveHour,
    weekly: toWindow(e.rateLimits.find(r => r.kind === 'seven_day')) ?? previous?.weekly,
    context: e.context.tokens === undefined ? (previous?.context ?? e.context) : e.context,
    threadUsd: e.cost?.usd ?? fallback,
    lastTurnUsd: previous?.lastTurnUsd,
    threadTokens: previous?.threadTokens,
    lastTurnTokens: previous?.lastTurnTokens,
  }
  await update($, snapshot, () => snap)
  // Kept for the next session's first figures; only the usage limits are read back.
  if (await isShown($, ['fiveHour', 'weekly'])) {
    await $.store.set('lastSnapshot', snap)
  }
  // The projection samples the 5-hour usage only while it is shown: turned on, it has a projection again once two
  // responses an hour apart or so have been sampled.
  if (!(await isShown($, 'burnRate'))) {
    await update($, projection, () => null)
    return
  }
  const now = await $.clock.now()
  let burn = ((await $.store.get('burn')) as BurnState | undefined) ?? EMPTY_BURN
  if (snap.fiveHour) {
    burn = addSample(burn, now, snap.fiveHour.percentUsed, snap.fiveHour.resetsAt)
    await $.store.set('burn', burn)
  }
  await update($, projection, () => project(burn, now))
}

/** Git without prompts (a push that needs a password fails rather than waits) or the index refresh `status` writes. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }

/** Runs git in `cwd`; a git that cannot start reads as a failed run. */
async function git($: EngineInterface, args: readonly string[], cwd: string, timeoutMs?: number) {
  try {
    return await $.process.run(['git', ...args], { cwd, env: GIT_ENV, timeoutMs })
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: String(error), isStdoutTruncated: false, isStderrTruncated: false }
  }
}

/** The branch merges are measured against: origin's default, else origin/main or master, else a local main or master. */
async function findBase($: EngineInterface, root: string, fallback: string | null): Promise<string> {
  const head = await git($, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root)
  if (head.exitCode === 0 && head.stdout.trim()) {
    return head.stdout.trim()
  }
  for (const name of ['origin/main', 'origin/master', 'main', 'master']) {
    if ((await git($, ['rev-parse', '--verify', '--quiet', name], root)).exitCode === 0) {
      return name
    }
  }

  return fallback ?? 'HEAD'
}

/** GitHub's pull requests and CI runs, through `gh`; left as they were when it is missing or signed out. */
async function readGithub($: EngineInterface, root: string): Promise<void> {
  const gh = (args: string[]) =>
    $.process.run(['gh', ...args], { cwd: root, env: { GH_PROMPT_DISABLED: '1' }, timeoutMs: 20_000 }).catch(() => null)
  const [prs, runs] = await Promise.all([
    gh(['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,url,state,headRefName,headRefOid,statusCheckRollup']),
    gh(['run', 'list', '--limit', '100', '--json', 'headSha,status,conclusion']),
  ])
  if (prs?.exitCode === 0) githubPrs = parsePrs(prs.stdout)
  if (runs?.exitCode === 0) githubRuns = parseRuns(runs.stdout)
}

/** What git says of one worktree: its changes, its commits the base lacks, its last commit, its lines added and removed. */
async function readWorktree($: EngineInterface, f: Omit<WorktreeFacts, 'changedFiles' | 'ahead' | 'added' | 'removed' | 'committedAt'>, root: string, base: string): Promise<WorktreeFacts> {
  const { entry } = f
  if (entry.isMissing) {
    // No folder to look in: its branch's commits are counted from the main checkout.
    const ahead = entry.branch === null ? null : await git($, ['rev-list', '--count', `${base}..${entry.branch}`], root)
    return { ...f, changedFiles: 0, ahead: Number(ahead?.stdout.trim() || 0), added: 0, removed: 0 }
  }
  const [status, ahead, mergeBase, last] = await Promise.all([
    git($, ['status', '--porcelain'], entry.path),
    git($, ['rev-list', '--count', `${base}..HEAD`], entry.path),
    git($, ['merge-base', 'HEAD', base], entry.path),
    git($, ['log', '-1', '--format=%ct'], entry.path),
  ])
  const stat = mergeBase.exitCode === 0 ? await git($, ['diff', '--shortstat', mergeBase.stdout.trim()], entry.path) : null

  return {
    ...f,
    changedFiles: countChanged(status.stdout),
    ahead: Number(ahead.stdout.trim() || 0),
    committedAt: last.exitCode === 0 && last.stdout.trim() ? Number(last.stdout.trim()) * 1000 : null,
    ...parseShortstat(stat?.stdout ?? ''),
  }
}

/** Reads every worktree of the session's repository into the pane, GitHub's word too when asked. */
async function readWorktrees($: EngineInterface, withGithub: boolean): Promise<void> {
  const cwd = await $.session.cwd()
  const top = await git($, ['rev-parse', '--show-toplevel'], cwd)
  if (top.exitCode !== 0) {
    await update($, worktrees, () => ({ status: 'error' as const, text: "This folder isn't in a git repository." }))
    return
  }
  const entries = parseWorktreeList((await git($, ['worktree', 'list', '--porcelain'], cwd)).stdout)
  const main = entries[0]
  if (main === undefined) {
    await update($, worktrees, () => ({ status: 'error' as const, text: "Git didn't list any worktrees." }))
    return
  }
  const root = main.path
  worktreeBase ??= await findBase($, root, main.branch)
  const base = worktreeBase
  const current = top.stdout.trim()
  const [refsRun] = await Promise.all([
    git($, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads'], root),
    withGithub ? readGithub($, root) : Promise.resolve(),
  ])
  const refs = parseBranchRefs(refsRun.stdout)
  const facts = await Promise.all(
    entries.map((entry, i) =>
      readWorktree($, { entry, isMain: i === 0, isCurrent: entry.path === current, ref: entry.branch === null ? undefined : refs.get(entry.branch) }, root, base),
    ),
  )
  // Closed while reading: nothing is shown, so nothing is kept.
  if (!(await read($, isWorktreesOpen))) {
    return
  }
  await update($, worktrees, () => ({ status: 'ready' as const, base, worktrees: facts.map(f => toWorktree(f, githubPrs, githubRuns)) }))
}

/**
 * Reads the pane again while it is open, one read at a time: a read asked for while one runs waits for it, and
 * several asked for meanwhile come to one.
 */
async function refreshWorktrees($: EngineInterface, withGithub = false): Promise<void> {
  if (!(await read($, isWorktreesOpen))) {
    return
  }
  if (worktreeReading !== null) {
    worktreeQueued = { withGithub: withGithub || (worktreeQueued?.withGithub ?? false) }
    return
  }
  worktreeReading = readWorktrees($, withGithub).catch(async error => {
    await update($, worktrees, () => ({ status: 'error' as const, text: `Couldn't read the worktrees: ${String(error)}` }))
  })
  await worktreeReading
  worktreeReading = null
  const queued = worktreeQueued
  worktreeQueued = null
  if (queued !== null) {
    await refreshWorktrees($, queued.withGithub)
  }
}

/** The pane's regular read, GitHub's every GITHUB_EVERY-th time; none while it removes worktrees. */
async function onWorktreeTick($: EngineInterface): Promise<void> {
  worktreeReads += 1
  if ((await read($, worktreeAction))?.step !== 'busy') {
    await refreshWorktrees($, worktreeReads % GITHUB_EVERY === 0)
  }
}

/** Runs the pane's reads only while it is open; closed, its timers stop and GitHub's word is dropped. */
function syncWorktrees($: EngineInterface, isOpen: boolean): void {
  if (isOpen) {
    worktreeTimer ??= $.clock.every(REFRESH_MS, () => void onWorktreeTick($))
    return
  }
  worktreeTimer?.cancel()
  worktreeSoon?.cancel()
  worktreeTimer = null
  worktreeSoon = null
  worktreeReads = 0
  worktreeBase = null
  githubPrs = new Map()
  githubRuns = new Map()
}

/** Opens or closes the Worktrees pane; opening reads everything at once, GitHub included. */
async function setWorktreesOpen($: EngineInterface, isOpen: boolean): Promise<void> {
  await update($, isWorktreesOpen, () => isOpen)
  syncWorktrees($, isOpen)
  if (!isOpen) {
    await $.ui.close({ id: WORKTREES_PANE })
    return
  }
  await update($, worktreeAction, () => null)
  await update($, worktrees, list => (list?.status === 'ready' ? list : { status: 'loading' as const }))
  await $.ui.open({ id: WORKTREES_PANE, title: 'Worktrees' })
  void refreshWorktrees($, true)
}

/** The 🛠 menu's Worktrees: opens the pane (its own close mark closes it), and closes the menu. */
async function openWorktrees($: EngineInterface): Promise<void> {
  await update($, isToolsOpen, () => false)
  await setWorktreesOpen($, true)
}

/** After a tool that can change files, the open pane reads again shortly: a burst of calls reads once. */
function worktreesSoon($: EngineInterface): void {
  worktreeSoon?.cancel()
  worktreeSoon = $.clock.after(AFTER_TOOL_MS, () => {
    worktreeSoon = null
    void refreshWorktrees($)
  })
}

/**
 * Removes one worktree, then its branch; its remote branch too when merged (an unmerged one's may hold the only copy
 * of its commits, so it stays). `force` removes a worktree with changes.
 */
async function removeWorktree($: EngineInterface, w: Worktree, root: string, force: boolean): Promise<Removal> {
  const result: Removal = { name: worktreeName(w), isRemoved: false, isBranchDeleted: false, isRemoteDeleted: false }
  const removed = w.isMissing
    ? await git($, ['worktree', 'prune'], root)
    : await git($, ['worktree', 'remove', ...(force ? ['--force'] : []), w.path], root, 60_000)
  if (removed.exitCode !== 0) {
    return { ...result, error: firstLine(removed.stderr) }
  }
  result.isRemoved = true
  if (w.branch !== null) {
    // Whether it is merged is the pane's own reckoning (a squash merge included), so git is not asked again.
    result.isBranchDeleted = (await git($, ['branch', '-D', w.branch], root)).exitCode === 0
    if (w.remote !== null && w.isMerged) {
      result.isRemoteDeleted = (await git($, ['push', w.remote.name, '--delete', w.remote.branch], root, 60_000)).exitCode === 0
    }
  }

  return result
}

/**
 * Carries out what the pane asked and the person said yes to: every worktree Clean may remove, or the one row. The
 * rows are read again first, so nothing changed since the last read is removed on stale facts. Clawd sweeps meanwhile,
 * for SWEEP_MS at least.
 */
async function confirmWorktrees($: EngineInterface): Promise<void> {
  const action = await read($, worktreeAction)
  if (action?.step !== 'ask') {
    return
  }
  const target: WorktreeTarget = action.target
  const startedAt = await $.clock.now()
  await update($, worktreeAction, () => ({ step: 'busy' as const, target }))
  await worktreeReading
  await readWorktrees($, false).catch(() => undefined)
  const list = await read($, worktrees)
  const rows = list?.status === 'ready' ? list.worktrees : []
  const root = rows.find(w => w.isMain)?.path ?? (await $.session.cwd())
  const results: Removal[] = []
  if (target.kind === 'clean') {
    for (const w of rows.filter(isCleanable)) {
      results.push(await removeWorktree($, w, root, false))
    }
    await git($, ['worktree', 'prune'], root)
  } else {
    const w = rows.find(row => row.path === target.path)
    if (w === undefined) {
      results.push({ name: target.path, isRemoved: false, isBranchDeleted: false, isRemoteDeleted: false, error: 'it is no longer listed' })
    } else if (!isDeletable(w)) {
      results.push({ name: worktreeName(w), isRemoved: false, isBranchDeleted: false, isRemoteDeleted: false, error: 'it is in use' })
    } else {
      results.push(await removeWorktree($, w, root, !isCleanable(w)))
    }
  }
  const done = removedText(results)
  await readWorktrees($, false).catch(() => undefined)
  const finish = () => void update($, worktreeAction, () => ({ step: 'done' as const, ...done }))
  const left = SWEEP_MS - ((await $.clock.now()) - startedAt)
  if (left > 0) {
    $.clock.after(left, finish)
  } else {
    finish()
  }
}

/** Sets the pane's question; a press while worktrees are being removed changes nothing. */
async function askWorktrees($: EngineInterface, target: WorktreeTarget | null): Promise<void> {
  await update($, worktreeAction, action => (action?.step === 'busy' ? action : target === null ? null : { step: 'ask' as const, target }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const loaded = await loadSettings(storeOf($))
    await update($, settings, () => loaded)
    // $.state outlives a hot reload: a snapshot already there is this session's, so keep it.
    // A new session carries over only the limits; thread cost and context are its own.
    if ((await read($, snapshot)) === null) {
      const last = (await $.store.get('lastSnapshot')) as Snapshot | undefined
      const usage = await $.session.usage()
      const fresh: Snapshot = {
        fiveHour: toWindow(usage.rateLimits.find(r => r.kind === 'five_hour')) ?? last?.fiveHour,
        weekly: toWindow(usage.rateLimits.find(r => r.kind === 'seven_day')) ?? last?.weekly,
        context: usage.context,
        threadUsd: usage.cost?.usd,
      }
      await update($, snapshot, () => fresh)
    }
    const hidden = (await $.store.get('isHidden')) === true
    await update($, isHidden, () => hidden)
    if (await isShown($, 'cacheWarmth')) {
      await restoreCacheAt($)
    }
    // The tick redraws countdowns while the bar shows, and checks whether the mascot has stood idle long enough to
    // fall asleep.
    $.clock.every(TICK_MS, () => void onTick($))
    await $.command.register({ name: 'aitools', description: 'Show or hide the aitools bar', argumentHint: '[on|off]' })
    const savedView = await $.store.get('viewMode')
    const view: ViewMode = savedView === 'task' || savedView === 'clean' ? savedView : 'off'
    await update($, viewMode, () => view)
    await showStatus($)
    // A load (a reload at a turn's end, a restart) sees no turn.complete for what came before: read it back, for
    // what is on.
    await startView($, view)
    const rows = await $.session.messages().catch(() => [])
    await update($, isAskable, () => isAskableIn(rows))
    if (await isMascotOn($)) {
      const isAsked = isQuestionOpenIn(rows)
      await update($, isQuestionOpen, () => isAsked)
      // A new session starts the mascot waving. A reload keeps his pose, but its timers went with the old module: a
      // moment pose gives way now and a transition still playing is dropped.
      const shown = await read($, mascot)
      if (shown.change === 0) {
        await showMascot($, 'wave', await restingPose($))
      } else if (ONE_SHOT_MS[shown.pose] !== undefined) {
        await showMascot($, shown.rest)
      } else {
        await settleMascot($, shown.change)
      }
    }
    await $.command.register({ name: 'taskview', description: 'Turn Task View on or off', argumentHint: '[on|off]' })
    await $.command.register({ name: 'cleanview', description: 'Turn Clean View on or off', argumentHint: '[on|off]' })
    const savedTeam = await $.store.get('agentTeam')
    const savedHelpers = await $.store.get('agentHelpers')
    await update($, team, () => (isTeamPick(savedTeam) ? savedTeam : 'default'))
    await update($, helpers, () => (savedHelpers === 'fast' ? 'fast' : 'same'))
    const savedShowing = await $.store.get('agentShowing')
    const savedHideAfter = await $.store.get('agentHideAfter')
    await update($, agentShowing, () => (isShowing(savedShowing) ? savedShowing : 'all'))
    await update($, hideAfter, () => (isHideAfter(savedHideAfter) ? savedHideAfter : DEFAULT_HIDE_AFTER))
    await $.command.register({ name: 'subagents', description: 'Open or close the Subagents pane' })
    // A reload starts the module's bookkeeping over: the running lines are the subagents still at work.
    liveHelpers.clear()
    for (const card of (await read($, agentRun))?.cards ?? []) {
      seenAgents.add(card.id)
      if (card.status === 'running' && (card.kind ?? 'helper') === 'helper') liveHelpers.add(card.id)
      if (card.status === 'running' && card.kind !== undefined && card.kind !== 'helper') trackedAgents.add(card.id)
    }
    // A reload takes the dock pane down with the old module; the dock stays open until the person closes it.
    if ((await read($, isDockOpen)) && !(await $.ui.panes()).some(p => p.id === DOCK_PANE)) {
      await $.ui.open({ id: DOCK_PANE, title: 'Subagents' })
    }
    await syncDock($)
    // The Notes pane went with the old module too: it opens again on the note as saved.
    if ((await read($, isNotesOpen)) && !(await $.ui.panes()).some(p => p.id === NOTES_PANE)) {
      await $.ui.open({ id: NOTES_PANE, title: 'Notes' })
      await loadNotes($)
    }
    await $.command.register({ name: 'worktrees', description: 'Open or close the Worktrees pane' })
    // The Worktrees pane went with the old module too, its timers with it: it opens again and reads afresh.
    if (await read($, isWorktreesOpen)) {
      await setWorktreesOpen($, true)
    }
    await $.command.register({ name: 'handoff', description: 'Print a handoff brief for a fresh session and copy it' })
    await $.command.register({
      name: 'askme',
      description: 'Ask the questions from the last answer as pop-up choices with a recommendation',
      argumentHint: '[note]',
    })
    startScan($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    if ((await read($, asking)) === 0) {
      await showMascot($, 'working')
    }
    // The cost when the turn started: the last-turn cost's baseline, only while it is shown.
    if (await isShown($, 'lastTurnCost')) {
      const cost = (await $.session.usage()).cost?.usd
      if (cost !== undefined) {
        await update($, turnBaseline, () => ({ turnId: e.turnId, usd: cost }))
      }
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      if (await isShown($, 'cacheWarmth')) {
        const at = await $.clock.now()
        await update($, cacheAt, () => at)
        // Persisting is a nicety (survives reloads); it must never hold up the model request.
        await rememberCacheAt($, at).catch(() => undefined)
      }
      // The chat's effort is what Same as chat helpers run at: kept while a team is picked.
      if (await isTeamPicked($)) {
        await update($, mainEffort, () => e.effort ?? null)
      }

      return yield* next(e)
    }
    // A subagent: its first request can come before its start is recorded, so an unknown one waits briefly for the
    // starts still in flight, then gets a line if it still has none.
    if (!liveHelpers.has(e.agentId) && startsInFlight.size > 0) {
      await waitAtMost($, Promise.all(startsInFlight), SPAWN_WAIT_MS)
    }
    if (!seenAgents.has(e.agentId)) {
      await noticeAgent($, e.agentId)
    }
    // A team helper: every request it makes runs on the team's model and effort.
    if (!liveHelpers.has(e.agentId)) {
      return yield* next(e)
    }
    if ((await read($, helpers)) === 'fast') {
      return yield* next({ ...e, model: FAST_MODEL, effort: FAST_EFFORT })
    }
    const effort = await read($, mainEffort)

    return yield* next(effort === null ? e : { ...e, effort })
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      // Only a subagent with a line is the pane's business.
      if (liveHelpers.has(id) || ((await read($, agentRun))?.cards.some(c => c.id === id) ?? false)) {
        await traceDock($, `finished ${id} (${e.reason})`)
        await endHelper($, id, e.reason === 'answer')
      }

      return next(e)
    }
    isTurnRunning = false
    const isAsking = e.reason === 'answer' && !isAskedThisRequest && asksQuestions(e.answer)
    await update($, isAskable, () => isAsking)
    if ((await read($, viewMode)) === 'clean') {
      await update($, finals, list => addFinal(list, e.answer))
    }
    if (await isMascotOn($)) {
      // A finished answer is celebrated, unless it asks something; a turn that failed or was interrupted startles him.
      const isAsked = e.reason === 'answer' && endsWithQuestion(e.answer)
      await update($, isQuestionOpen, () => isAsked)
      const rest = await restingPose($)
      await showMascot($, e.reason !== 'answer' ? 'error' : isAsked ? 'puzzled' : 'celebrate', rest)
    }
    const baseline = await read($, turnBaseline)
    const base = baseline?.turnId === e.turnId ? baseline.usd : undefined
    await update($, turnBaseline, () => null)
    if (e.usage !== undefined) {
      const lastTurnTokens = usageTokens(e.usage)
      await update($, snapshot, snap => ({ ...(snap ?? {}), lastTurnTokens }))
    }
    if (await isShown($, COST_KEYS)) {
      const cost = (await $.session.usage()).cost?.usd
      if (cost !== undefined) {
        const lastTurnUsd = base === undefined ? undefined : cost - base
        await update($, snapshot, snap => ({ ...(snap ?? {}), threadUsd: cost, lastTurnUsd }))
      }
    }
    startScan($)
    // Any subagent whose finish went unheard is settled once Claude replies.
    await settleCards($)

    return next(e)
  })

  on('command.run', { command: 'aitools' }, async ($, e) => {
    const hidden = nextHidden(e.args, await read($, isHidden))
    if (hidden === null) {
      return { text: 'Usage: /aitools [on|off] (no argument toggles the bar)' }
    }
    await update($, isHidden, () => hidden)
    await $.store.set('isHidden', hidden)
    if (!hidden) {
      await catchUp($)
    }

    return { text: hidden ? 'aitools bar hidden. Run /aitools to show it.' : 'aitools bar shown.' }
  })

  on('command.run', { command: 'taskview' }, ($, e) => viewCommand($, 'task', e.args))
  on('command.run', { command: 'cleanview' }, ($, e) => viewCommand($, 'clean', e.args))

  // The brief is the command's output row: the chat renders it as markdown.
  on('command.run', { command: 'handoff' }, async $ => ({ text: await handoff($) }))

  // A command may not submit a prompt while it runs (the prompt would wait on the command), so a timer sends it just
  // after; it then runs as the next turn.
  on('command.run', { command: 'askme' }, ($, e) => {
    const text = askmeText(e.args)
    $.clock.after(0, () => {
      $.prompt.submit({ text, asUser: true }).catch(() => undefined)
    })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: HANDOFF_PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const shown = await read($, brief)
    if (shown === null || shown.status === 'writing') {
      return <Text dimColor>Writing the handoff brief…</Text>
    }
    if (shown.status === 'error') {
      return <Text color="red">{shown.text}</Text>
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="flex-end">
          <Button key="copy" label="Copy" plain dimColor onPress={press => void copyBrief($, press.surface)} />
        </Box>
        <Markdown text={paneMarkdown(shown.text)} />
      </Box>
    )
  })

  // The person's own prompt starts a new request, whatever is on: a fresh checklist (the Subagents pane keeps its
  // finished lines for the session). A helper's report or a task notice arrives as a prompt too, and starts nothing.
  // A view on, or the pane with a team picked, adds its note.
  on('prompt.submit', async ($, e, next) => {
    if (PERSON_ORIGINS.has(e.origin.kind)) {
      await update($, checklist, () => null)
      await update($, isQuestionOpen, () => false)
      await update($, isAskable, () => false)
      isAskedThisRequest = false
      // Where the pane's Current task agents start.
      if (await read($, isDockOpen)) {
        const at = await $.clock.now()
        await update($, requestAt, () => at)
      }
    }
    const notes: string[] = []
    const view = viewNote(await read($, viewMode))
    if (view !== null) notes.push(view)
    const size = await activeTeam($)
    if (size !== null) notes.push(dockNote(size))

    return notes.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...notes] })
  })

  // With a team picked, a helper the main chat starts runs on the team's model, reports progress, and waits its turn
  // when the team is full (refused with a note: a hook may not hold the start for long). Any other subagent started
  // while the pane is open gets a line too, following its tool calls and the progress it reports.
  on('agent.spawn', async ($, e, next) => {
    if (e.fork) {
      return next(e)
    }
    const size = e.parentAgentId === undefined ? await activeTeam($) : null
    if (size === null) {
      return startSubagent($, e, next)
    }
    const now = await $.clock.now()
    const model = (await read($, helpers)) === 'fast' ? FAST_MODEL : e.parentModel
    // Check and take a place with no `await` in between, so starts in the same message count each other.
    const working = liveHelpers.size + reservedPlaces
    if (working >= size) {
      await traceDock($, `queued ${e.description} (${working} of ${size} working)`)
      await update($, agentRun, r => queuePiece(r ?? newRun(now), e.description))
      return { deny: `Subagents: all ${size} helpers are busy. Start "${e.description}" again once one finishes.` }
    }
    reservedPlaces += 1
    let settle = () => {}
    const inFlight = new Promise<void>(resolve => (settle = resolve))
    startsInFlight.add(inFlight)
    try {
      const started = await next({ ...e, model, prompt: e.prompt + HELPER_NOTE })
      await traceDock($, `started ${e.description}: ${started.agentId ?? started.deny ?? 'no id'}`)
      if (started.agentId !== undefined) {
        const id = started.agentId
        liveHelpers.add(id)
        seenAgents.add(id)
        await update($, agentRun, r => addCard(r ?? newRun(now), id, e.description, now, 'helper'))
        await startDockTimer($)
      }

      return started
    } finally {
      reservedPlaces -= 1
      startsInFlight.delete(inFlight)
      settle()
    }
  })

  // A workflow the main chat starts: its agents' lines take its name.
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    if (e.agentId === undefined) {
      lastWorkflow = workflowName(e as unknown as Record<string, unknown>)
      workflowAgents = 0
    }

    return next(e)
  })

  // A subagent's own report: answered here, so it never asks for permission.
  on('tool.call', { tool: PROGRESS_TOOL_ID }, async ($, e) => {
    const id = e.agentId
    if (id === undefined) {
      return { deny: 'Only subagents report progress.' }
    }
    const doing = typeof e.doing === 'string' ? e.doing : ''
    const percent = typeof e.percent === 'number' ? e.percent : 0
    await update($, agentRun, run => (run === null ? run : reportProgress(run, id, doing, percent)))

    return { result: 'Progress noted.' }
  })

  on('command.run', { command: 'subagents' }, async $ => {
    if (!(await toggleDock($))) {
      return { text: 'Subagents closed.' }
    }
    const size = await read($, team)
    if (size === 'default') {
      return { text: 'Subagents open: Default, subagents run as usual.' }
    }

    return { text: `Subagents open: ${size} ${HELPER_LABELS[await read($, helpers)]} helpers.` }
  })

  on('command.run', { command: 'worktrees' }, async $ => {
    const isOpen = !(await read($, isWorktreesOpen))
    await setWorktreesOpen($, isOpen)

    return { text: isOpen ? 'Worktrees open.' : 'Worktrees closed.' }
  })

  on('ui.render', { component: 'Pane', requestId: WORKTREES_PANE }, async ($, e) => {
    const view = { list: await read($, worktrees), action: await read($, worktreeAction), now: await $.clock.now() }
    const el = $.ui.resolve(e)
    // Clawd is SVG: the terminal never gets him, whatever its table holds.
    const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined

    return renderWorktrees({ Box: el.Box, Text: el.Text, Button: el.Button, Svg }, view, {
      ask: target => void askWorktrees($, target),
      confirm: () => void confirmWorktrees($),
      cancel: () => void askWorktrees($, null),
    })
  })

  on('ui.render', { component: 'Pane', requestId: DOCK_PANE }, async ($, e) => {
    await read($, dockTick)
    // The 30-second tick keeps finished lines' `3m ago` current.
    await read($, tick)
    const state = {
      team: await read($, team),
      helpers: await read($, helpers),
      showing: await read($, agentShowing),
      hideAfter: await read($, hideAfter),
      requestAt: await read($, requestAt),
      run: await read($, agentRun),
      now: await $.clock.now(),
    }

    const el = $.ui.resolve(e)
    // The totem is SVG: the terminal never gets it, whatever its table holds.
    const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined

    return renderDock({ Box: el.Box, Text: el.Text, Button: el.Button, Svg }, state, {
      setTeam: size => void setTeam($, size),
      setHelpers: mode => void setHelpers($, mode),
      setShowing: showing => void setShowing($, showing),
      setHideAfter: minutes => void setHideAfter($, minutes),
    })
  })

  // The person closing the dock pane turns the dock off; the mod's own close has already, and an unload (a reload)
  // leaves the setting for the pane the next load opens.
  on('ui.render', { component: 'Pane', requestId: NOTES_PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const shown = await read($, notes)
    if (shown === null) {
      return <Text dimColor>Loading the note…</Text>
    }
    if ('error' in shown) {
      return <Text color="red">{shown.error}</Text>
    }
    if (!('Client' in el)) {
      return <Text dimColor>{`The note can't be edited here; it is kept in ${NOTES_FILE}.`}</Text>
    }
    const { Client } = el

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={FAINT_TEXT}>{`Note saved to ${NOTES_FILE} in your project.`}</Text>
          <Button key="copy" label="Copy" plain dimColor onPress={press => void copyNotes($, press.surface)} />
        </Box>
        <Client key={NOTES_EDITOR} module="../src/noteseditor.tsx" props={{ text: shown.text, columns: e.props.bodyColumns }} />
      </Box>
    )
  })

  // The editor posts the whole note after each change.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== NOTES_PANE) {
      return next(e)
    }
    const data = e.data as { text?: unknown } | null
    if (typeof data?.text === 'string') {
      saveNotes($, data.text)
    }

    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === NOTES_PANE && e.origin.kind === 'person') {
      await update($, isNotesOpen, () => false)
    }
    if (e.id === WORKTREES_PANE && e.origin.kind === 'person') {
      await update($, isWorktreesOpen, () => false)
      syncWorktrees($, false)
    }
    if (e.id === DOCK_PANE && e.origin.kind === 'person') {
      await update($, isDockOpen, () => false)
      await syncDock($)
      await showStatus($)
    }

    return next(e)
  })

  // The mascot follows the main chat's tools: reading while a read-only tool runs, puzzled while an AskUserQuestion
  // dialog waits (its `next` resolves once answered), startled when a call fails or is refused.
  //
  // A subagent with a line in the Subagents pane shows its latest tool call there, while the pane is open:
  // `Reading bar.tsx`, `Running npm test`.
  on('tool.call', async ($, e, next) => {
    try {
      if (e.agentId !== undefined) {
        if (trackedAgents.has(e.agentId) && (await read($, isDockOpen))) {
          const id = e.agentId
          const doing = activityText(e.tool, e as unknown as Record<string, unknown>)
          await update($, agentRun, run => (run === null ? run : noteActivity(run, id, doing)))
        }
        return next(e)
      }
      if (QUIET_TOOLS.has(e.tool) || !(await isMascotOn($))) {
        return next(e)
      }
      if (e.tool === 'AskUserQuestion') {
        await update($, asking, n => n + 1)
        await showMascot($, 'puzzled', 'working')
        try {
          return await next(e)
        } finally {
          await update($, asking, n => Math.max(0, n - 1))
          await showMascot($, 'working')
        }
      }
      const isReading = READ_TOOLS.has(e.tool)
      if (isReading) {
        readsInFlight += 1
        await showMascot($, 'reading', 'working')
      }
      let isFailed = true
      try {
        const result = await next(e)
        isFailed = result.deny !== undefined || result.isError === true
        return result
      } finally {
        if (isReading) {
          readsInFlight = Math.max(0, readsInFlight - 1)
        }
        if (isFailed) {
          await showMascot($, 'error', readsInFlight > 0 ? 'reading' : 'working')
        } else if (isReading && readsInFlight === 0) {
          await showMascot($, 'working')
        }
      }
    } finally {
      // While the Worktrees pane is open, a tool that can change files reads it again shortly after.
      if (CHANGING_TOOLS.has(e.tool) && (await read($, isWorktreesOpen))) {
        worktreesSoon($)
      }
    }
  })

  // Questions put as pop-up choices need no ? button for the rest of the request.
  on('tool.call', { tool: ASK_TOOL }, async ($, e, next) => {
    if (e.agentId === undefined) {
      isAskedThisRequest = true
      await update($, isAskable, () => false)
    }

    return next(e)
  })

  // Answered here without `next`: the call never reaches a permission dialog, and nothing runs but this.
  on('tool.call', { tool: CHECKLIST_TOOL_ID }, async ($, e) => {
    const parsed = parseChecklist(e)
    if (typeof parsed === 'string') {
      return { deny: `Checklist not updated: ${parsed}` }
    }
    await update($, checklist, () => parsed)

    return { result: 'Checklist updated.' }
  })

  // Clean View hides every tool row; Task View hides only the checklist tool's own, which the band already shows.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const mode = await read($, viewMode)
    const isRowHidden = mode === 'clean' || (mode === 'task' && e.props.tool === CHECKLIST_TOOL_ID)

    return isRowHidden ? drawNothing($, e) : next(e)
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const mode = await read($, viewMode)
    const isRowHidden = mode === 'clean' || (mode === 'task' && e.props.tool === CHECKLIST_TOOL_ID)

    return isRowHidden ? drawNothing($, e) : next(e)
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => ((await read($, viewMode)) === 'clean' ? drawNothing($, e) : next(e)))
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => ((await read($, viewMode)) === 'clean' ? drawNothing($, e) : next(e)))

  // Clean View shows only text that belongs to a finished turn's final reply; the rest is work in progress.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if ((await read($, viewMode)) !== 'clean' || isFinalReply(e.props.text, await read($, finals))) {
      return next(e)
    }

    return drawNothing($, e)
  })

  // The band holds one tree, so the bar stacks above whatever the plugins beneath drew
  // rather than ending the chain; core's own drawing beneath is left out.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }
    const below = await next(e)
    const el = $.ui.resolve(e)
    // The mascot is SVG: the terminal never gets it, whatever its table holds.
    const Svg = e.surface !== 'terminal' && 'Svg' in el ? el.Svg : undefined
    const bar = await drawBar($, { Box: el.Box, Text: el.Text, Button: el.Button, Svg }, e.props.isWorking)
    const { Box } = el
    // The terminal sets the bar off from the chat above by a blank line; the desktop's band has its own room.
    const top = e.surface === 'terminal' ? TERMINAL_TOP_MARGIN : 0
    if (below.type === 'engine') {
      return top ? <Box flexDirection="column" width="100%" marginTop={top}>{bar}</Box> : bar
    }
    return (
      <Box flexDirection="column" width="100%" gap={1} marginTop={top}>
        {bar}
        {below}
      </Box>
    )
  })
}
