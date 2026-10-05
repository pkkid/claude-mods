import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EMPTY_ALERTS, checkAlerts } from '../src/alerts'
import type { AlertState } from '../src/alerts'
import {
  FAST_EFFORT,
  FAST_MODEL,
  HELPER_LABELS,
  HELPER_NOTE,
  PROGRESS_SPEC,
  PROGRESS_TOOL_ID,
  DOCK_PANE,
  addCard,
  dockNote,
  finishCard,
  isRunning,
  isTeamSize,
  newRun,
  queuePiece,
  renderDock,
  reportProgress,
} from '../src/agentdock'
import { renderBar } from '../src/bar'
import {
  CHECKLIST_SPEC,
  CHECKLIST_TOOL_ID,
  VIEW_NAMES,
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
import { DEFAULT_SETTINGS, loadSettings, nextHidden, normalizeSettings, saveSettings } from '../src/settings'
import type { KeyStore } from '../src/settings'
import { scanMonth, sessionUsd } from '../src/transcripts'
import type { ScanCache, ScanIO } from '../src/transcripts'
import type { Brief, HelperMode, LimitWindow, Snapshot, TeamSize, ViewMode } from '../types'

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
const team = atom({ plugin: 'aitools', key: 'team' } as const, 5)
const helpers = atom({ plugin: 'aitools', key: 'helpers' } as const, 'fast')
const agentRun = atom({ plugin: 'aitools', key: 'agentRun' } as const, null)
const mainEffort = atom({ plugin: 'aitools', key: 'mainEffort' } as const, null)
const dockTick = atom({ plugin: 'aitools', key: 'dockTick' } as const, 0)

const HANDOFF_PANE = 'handoff'

/** Prompt origins that are the person's own words; anything else (a helper's report, a notice) is not a new request. */
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])
/** How many Agent Dock trace lines the store keeps. */
const TRACE_KEEP = 60
/** How long a helper's first model request waits for its own start to be recorded, at most. */
const SPAWN_WAIT_MS = 2000

/**
 * Agent Dock bookkeeping that must change without an `await` between check and write, so helpers started together
 * in one message see each other: the team places taken by starts still in flight, the helpers with a running card,
 * and the starts in flight, which a helper's first model request may wait on before its card exists.
 */
let reservedPlaces = 0
const liveHelpers = new Set<string>()
const startsInFlight = new Set<Promise<void>>()
/** Trace writes run one after another, so lines written at once are all kept. */
let traceQueue: Promise<void> = Promise.resolve()

const encoder = new TextEncoder()
const TICK_MS = 30_000
/** Cache times older than this are dropped from the per-session store. */
const CACHE_KEEP_MS = 2 * 60 * 60_000

/** The latest scan, kept here too so a store write that fails costs nothing but persistence. */
let memoryCache: ScanCache | null = null
let isScanning = false
let isScanPending = false
let hasLoggedScanError = false

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
      await update($, month, () => ({ usd: next.usd, isEstimate: next.isEstimate, status: 'ready' as const }))
    } while (isScanPending)
  } catch (err) {
    await update($, month, m => ({ usd: m?.usd ?? 0, isEstimate: m?.isEstimate ?? false, status: 'error' as const }))
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

function startScan($: EngineInterface): void {
  $.clock.after(0, () => void scan($))
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

/**
 * The 🛠 menu's Workflows: runs the built-in /workflows. A mod's own commands skip its own hooks, but this one is core's.
 * The desktop Code tab answers a typed /workflows itself and the engine has no such command, so there it is staged in
 * the prompt box for the person to send.
 */
async function runWorkflows($: EngineInterface): Promise<void> {
  await update($, isToolsOpen, () => false)
  const commands = await $.command.list()
  if (!commands.some(c => c.name === 'workflows')) {
    const filled = await $.prompt.fill({ text: '/workflows' })
    if (!filled.isFilled) {
      $.ui.toast('Type /workflows to see workflows')
    }
    return
  }
  try {
    const ran = await $.command.run({ command: 'workflows' })
    if (ran.text) {
      $.ui.toast(ran.text)
    }
  } catch (err) {
    $.ui.toast(`/workflows failed: ${errorText(err)}`)
  }
}

async function toggleSetting($: EngineInterface, key: keyof typeof DEFAULT_SETTINGS): Promise<void> {
  const changed = await update($, settings, s => {
    const was = normalizeSettings(s)

    return { ...was, [key]: !was[key] }
  })
  await saveSettings(storeOf($), normalizeSettings(changed))
}

/** The 🛠 menu's Task View and Clean View: sets the view, saves it for later sessions and closes the menu. */
async function setView($: EngineInterface, mode: ViewMode): Promise<void> {
  await update($, isToolsOpen, () => false)
  await update($, viewMode, () => mode)
  await $.store.set('viewMode', mode)
  await showStatus($)
}

/**
 * The status line under the prompt: the view that is on and the Agent Dock, comma separated; cleared when none. A dock
 * whose pane is open but not on screen (waiting for room) applies nothing, and says so.
 */
async function showStatus($: EngineInterface): Promise<void> {
  const mode = await read($, viewMode)
  const parts: string[] = mode === 'off' ? [] : [VIEW_NAMES[mode]]
  if (await read($, isDockOpen)) {
    const pane = (await $.ui.panes()).find(p => p.id === DOCK_PANE)
    parts.push(pane?.isPlaced === false ? 'Agent Dock (not shown)' : 'Agent Dock')
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

/** Redraws the dock's helper times, only while a helper runs. */
async function bumpDockTick($: EngineInterface): Promise<void> {
  if (isRunning(await read($, agentRun))) {
    await update($, dockTick, n => n + 1)
  }
}

/** Opens or closes the Agent Dock pane; closed, none of its settings apply. */
async function setDockOpen($: EngineInterface, isOpen: boolean): Promise<void> {
  await update($, isDockOpen, () => isOpen)
  if (isOpen) {
    await $.ui.open({ id: DOCK_PANE, title: 'Agent Dock' })
  } else {
    await $.ui.close({ id: DOCK_PANE })
  }
  await showStatus($)
}

/**
 * Whether the dock applies: it is open and its pane is on screen. A dock pane that went away turns it off; one that is
 * open but not on screen applies nothing, which the status line says.
 */
async function isDockActive($: EngineInterface): Promise<boolean> {
  if (!(await read($, isDockOpen))) {
    return false
  }
  const pane = (await $.ui.panes()).find(p => p.id === DOCK_PANE)
  if (pane === undefined) {
    await update($, isDockOpen, () => false)
  }
  await showStatus($)

  return pane?.isPlaced === true
}

/** The 🛠 menu's Agent Dock: opens the dock if closed, closes it if open, and closes the menu. */
async function toggleDock($: EngineInterface): Promise<boolean> {
  await update($, isToolsOpen, () => false)
  const isOpen = !(await read($, isDockOpen))
  await setDockOpen($, isOpen)

  return isOpen
}

/** The dock's team size, saved for later sessions. */
async function setTeam($: EngineInterface, size: TeamSize): Promise<void> {
  await update($, team, () => size)
  await $.store.set('agentTeam', size)
}

/** The dock's helper model, saved for later sessions. */
async function setHelpers($: EngineInterface, mode: HelperMode): Promise<void> {
  await update($, helpers, () => mode)
  await $.store.set('agentHelpers', mode)
}

/** Appends one line to the Agent Dock trace in the store, the newest TRACE_KEEP kept, one write after another. */
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

/** Marks a helper finished: its place on the team frees up and its card turns done or failed. */
async function endHelper($: EngineInterface, id: string, isAnswered: boolean): Promise<void> {
  liveHelpers.delete(id)
  const now = await $.clock.now()
  await update($, agentRun, run => (run === null ? run : finishCard(run, id, isAnswered, now)))
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
  // A helper the engine no longer lists has finished too; only one listed as running or pending is still at work.
  for (const card of run?.cards.filter(c => c.status === 'running') ?? []) {
    const status = agents.find(a => a.id === card.id)?.status ?? 'gone'
    if (status !== 'running' && status !== 'pending') {
      await traceDock($, `settled ${card.task}: ${status}`)
      await endHelper($, card.id, status !== 'failed' && status !== 'killed')
    }
  }
}

/** Once every helper of a run has finished and Claude has replied, marks it reported: the dock adds its finish line. */
async function reportRun($: EngineInterface): Promise<void> {
  await settleCards($)
  const run = await read($, agentRun)
  if (run === null || run.cards.length === 0 || run.isReported || isRunning(run)) {
    if (run !== null && run.cards.length > 0 && !run.isReported) {
      await traceDock($, `not reported yet: ${run.cards.filter(c => c.status === 'running').length} still running`)
    }
    return
  }
  await traceDock($, `reported ${run.cards.length} helpers`)
  await update($, agentRun, r => (r === null ? r : { ...r, isReported: true }))
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
    viewMode: await read($, viewMode),
    isDockOpen: await read($, isDockOpen),
  }
  const list = flags.viewMode === 'off' ? null : renderChecklist(el, await read($, checklist), isWorking)

  return renderBar(el, view, flags, {
    toggleTools: () => void toggleMenu($, 'tools'),
    handoff: () => void showHandoff($),
    workflows: () => void runWorkflows($),
    toggleSettings: () => void toggleMenu($, 'settings'),
    setView: mode => void setView($, mode),
    toggleDock: () => void toggleDock($),
    toggle: key => void toggleSetting($, key),
  }, list)
}

async function measure($: EngineInterface, e: { rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]; context: Snapshot['context'] & {}; cost?: { usd: number } }) {
  const previous = await read($, snapshot)
  const cache = e.cost ? null : await readCache($)
  const fallback = cache ? sessionUsd(cache, await $.session.id()) : undefined
  const snap: Snapshot = {
    fiveHour: toWindow(e.rateLimits.find(r => r.kind === 'five_hour')) ?? previous?.fiveHour,
    weekly: toWindow(e.rateLimits.find(r => r.kind === 'seven_day')) ?? previous?.weekly,
    context: e.context.tokens === undefined ? (previous?.context ?? e.context) : e.context,
    threadUsd: e.cost?.usd ?? fallback,
    lastTurnUsd: previous?.lastTurnUsd,
  }
  await update($, snapshot, () => snap)
  await $.store.set('lastSnapshot', snap)

  const now = await $.clock.now()
  let burn = ((await $.store.get('burn')) as BurnState | undefined) ?? EMPTY_BURN
  if (snap.fiveHour) {
    burn = addSample(burn, now, snap.fiveHour.percentUsed, snap.fiveHour.resetsAt)
    await $.store.set('burn', burn)
  }
  await update($, projection, () => project(burn, now))

  if (normalizeSettings(await read($, settings)).thresholdAlerts) {
    const alertState = ((await $.store.get('alerts')) as AlertState | undefined) ?? EMPTY_ALERTS
    const { state, alerts } = checkAlerts(alertState, snap)
    await $.store.set('alerts', state)
    for (const text of alerts) {
      $.ui.toast(text)
    }
  }
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
    await restoreCacheAt($)
    $.clock.every(TICK_MS, () => void update($, tick, n => (n ?? 0) + 1))
    const hidden = (await $.store.get('isHidden')) === true
    await update($, isHidden, () => hidden)
    await $.command.register({ name: 'aitools', description: 'Show or hide the aitools bar', argumentHint: '[on|off]' })
    const savedView = await $.store.get('viewMode')
    const view: ViewMode = savedView === 'task' || savedView === 'clean' ? savedView : 'off'
    await update($, viewMode, () => view)
    await showStatus($)
    // A load (a reload at a turn's end, a restart) sees no turn.complete for what came before: read it back.
    const earlier = finalReplies(await $.session.messages().catch(() => []))
    await update($, finals, list => earlier.reduce((acc, text) => addFinal(acc, text), list))
    await $.command.register({ name: 'taskview', description: 'Turn Task View on or off', argumentHint: '[on|off]' })
    await $.command.register({ name: 'cleanview', description: 'Turn Clean View on or off', argumentHint: '[on|off]' })
    const savedTeam = await $.store.get('agentTeam')
    const savedHelpers = await $.store.get('agentHelpers')
    await update($, team, () => (isTeamSize(savedTeam) ? savedTeam : 5))
    await update($, helpers, () => (savedHelpers === 'same' ? 'same' : 'fast'))
    await $.command.register({ name: 'agentdock', description: 'Open or close the Agent Dock' })
    // A reload starts the module's bookkeeping over: the running cards are the helpers still at work.
    liveHelpers.clear()
    for (const card of (await read($, agentRun))?.cards ?? []) {
      if (card.status === 'running') liveHelpers.add(card.id)
    }
    // A reload takes the dock pane down with the old module; the dock stays open until the person closes it.
    if ((await read($, isDockOpen)) && !(await $.ui.panes()).some(p => p.id === DOCK_PANE)) {
      await $.ui.open({ id: DOCK_PANE, title: 'Agent Dock' })
    }
    // Helper times tick each second, but only while a helper runs.
    $.clock.every(1000, () => void bumpDockTick($))
    await $.command.register({ name: 'handoff', description: 'Print a handoff brief for a fresh session and copy it' })
    startScan($)
    // Last, and caught: without the checklist tool the views still hide rows and the bar still runs.
    await $.tool.register(CHECKLIST_SPEC).catch(err => $.ui.log(`aitools: checklist tool not registered: ${errorText(err)}`))
    await $.tool.register(PROGRESS_SPEC).catch(err => $.ui.log(`aitools: agent_progress tool not registered: ${errorText(err)}`))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const cost = (await $.session.usage()).cost?.usd
    if (cost !== undefined) {
      await update($, turnBaseline, () => ({ turnId: e.turnId, usd: cost }))
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, cacheAt, () => at)
      await update($, mainEffort, () => e.effort ?? null)
      // Persisting is a nicety (survives reloads); it must never hold up the model request.
      await rememberCacheAt($, at).catch(() => undefined)

      return yield* next(e)
    }
    // An Agent Dock helper: every request it makes runs on the dock's model and effort. Its first request can come
    // before its start is recorded, so an unknown helper waits briefly for the starts still in flight.
    if (!liveHelpers.has(e.agentId) && startsInFlight.size > 0) {
      await waitAtMost($, Promise.all(startsInFlight), SPAWN_WAIT_MS)
    }
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
      const known = (await read($, agentRun))?.cards.some(c => c.id === id) ?? false
      await traceDock($, `finished ${id} (${e.reason})${known ? '' : ', no card'}`)
      await endHelper($, id, e.reason === 'answer')

      return next(e)
    }
    await update($, finals, list => addFinal(list, e.answer))
    const baseline = await read($, turnBaseline)
    const base = baseline?.turnId === e.turnId ? baseline.usd : undefined
    await update($, turnBaseline, () => null)
    const cost = (await $.session.usage()).cost?.usd
    if (cost !== undefined) {
      const lastTurnUsd = base === undefined ? undefined : cost - base
      await update($, snapshot, snap => ({ ...(snap ?? {}), threadUsd: cost, lastTurnUsd }))
    }
    startScan($)
    await reportRun($)

    return next(e)
  })

  on('command.run', { command: 'aitools' }, async ($, e) => {
    const hidden = nextHidden(e.args, await read($, isHidden))
    if (hidden === null) {
      return { text: 'Usage: /aitools [on|off] (no argument toggles the bar)' }
    }
    await update($, isHidden, () => hidden)
    await $.store.set('isHidden', hidden)

    return { text: hidden ? 'aitools bar hidden. Run /aitools to show it.' : 'aitools bar shown.' }
  })

  on('command.run', { command: 'taskview' }, ($, e) => viewCommand($, 'task', e.args))
  on('command.run', { command: 'cleanview' }, ($, e) => viewCommand($, 'clean', e.args))

  // The brief is the command's output row: the chat renders it as markdown.
  on('command.run', { command: 'handoff' }, async $ => ({ text: await handoff($) }))

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

  // The person's own prompt starts a new request, whatever is on: a fresh checklist, and the last helpers' cards
  // cleared once none still runs. A helper's report or a task notice arrives as a prompt too, and starts nothing.
  // A view or the dock on adds its note.
  on('prompt.submit', async ($, e, next) => {
    if (PERSON_ORIGINS.has(e.origin.kind)) {
      await update($, checklist, () => null)
      if (!isRunning(await read($, agentRun)) && (await read($, agentRun)) !== null) {
        await traceDock($, `reset by ${e.origin.kind} prompt`)
        await update($, agentRun, () => null)
      }
    }
    const notes: string[] = []
    const view = viewNote(await read($, viewMode))
    if (view !== null) notes.push(view)
    if (await isDockActive($)) notes.push(dockNote(await read($, team)))

    return notes.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...notes] })
  })

  // The dock open: a helper the main chat starts runs on the dock's model, reports progress, and waits its turn
  // when the team is full (refused with a note: a hook may not hold the start for long).
  on('agent.spawn', async ($, e, next) => {
    if (e.fork || e.parentAgentId !== undefined) {
      return next(e)
    }
    if (!(await isDockActive($))) {
      if (await read($, isDockOpen)) await traceDock($, `ignored ${e.description}: dock pane not on screen`)
      return next(e)
    }
    const now = await $.clock.now()
    const size = await read($, team)
    const model = (await read($, helpers)) === 'fast' ? FAST_MODEL : e.parentModel
    // Check and take a place with no `await` in between, so starts in the same message count each other.
    const working = liveHelpers.size + reservedPlaces
    if (working >= size) {
      await traceDock($, `queued ${e.description} (${working} of ${size} working)`)
      await update($, agentRun, r => queuePiece(r ?? newRun(now), e.description))
      return { deny: `Agent Dock: all ${size} helpers are busy. Start "${e.description}" again once one finishes.` }
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
        await update($, agentRun, r => addCard(r ?? newRun(now), id, e.description, now))
      }

      return started
    } finally {
      reservedPlaces -= 1
      startsInFlight.delete(inFlight)
      settle()
    }
  })

  // A helper's own report: answered here, so it never asks for permission.
  on('tool.call', { tool: PROGRESS_TOOL_ID }, async ($, e) => {
    const id = e.agentId
    if (id === undefined) {
      return { deny: 'Only Agent Dock helpers report progress.' }
    }
    const doing = typeof e.doing === 'string' ? e.doing : ''
    const percent = typeof e.percent === 'number' ? e.percent : 0
    await update($, agentRun, run => (run === null ? run : reportProgress(run, id, doing, percent)))

    return { result: 'Progress noted.' }
  })

  on('command.run', { command: 'agentdock' }, async $ => {
    if (!(await toggleDock($))) {
      return { text: 'Agent Dock closed.' }
    }
    const size = await read($, team)

    return { text: `Agent Dock open: ${size} ${HELPER_LABELS[await read($, helpers)]} helper${size === 1 ? '' : 's'}.` }
  })

  on('ui.render', { component: 'Pane', requestId: DOCK_PANE }, async ($, e) => {
    await read($, dockTick)
    const state = {
      team: await read($, team),
      helpers: await read($, helpers),
      run: await read($, agentRun),
      now: await $.clock.now(),
    }

    return renderDock($.ui.resolve(e), state, {
      setTeam: size => void setTeam($, size),
      setHelpers: mode => void setHelpers($, mode),
    })
  })

  // The person closing the dock pane turns the dock off; the mod's own close has already, and an unload (a reload)
  // leaves the setting for the pane the next load opens.
  on('ui.close', async ($, e, next) => {
    if (e.id === DOCK_PANE && e.origin.kind === 'person') {
      await update($, isDockOpen, () => false)
      await showStatus($)
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
    const bar = await drawBar($, el, e.props.isWorking)
    if (below.type === 'engine') return bar
    const { Box } = el
    return (
      <Box flexDirection="column" width="100%" gap={1}>
        {bar}
        {below}
      </Box>
    )
  })
}
