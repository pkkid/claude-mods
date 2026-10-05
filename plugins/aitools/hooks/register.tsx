import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EMPTY_ALERTS, checkAlerts } from '../src/alerts'
import type { AlertState } from '../src/alerts'
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
import type { Brief, LimitWindow, Snapshot, ViewMode } from '../types'

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

const HANDOFF_PANE = 'handoff'

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
  showViewStatus($, mode)
}

/** Names the view that is on in the status line under the prompt; clears it when both are off. */
function showViewStatus($: EngineInterface, mode: ViewMode): void {
  $.ui.status(mode === 'off' ? undefined : VIEW_NAMES[mode])
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
  }
  const list = flags.viewMode === 'off' ? null : renderChecklist(el, await read($, checklist), isWorking)

  return renderBar(el, view, flags, {
    toggleTools: () => void toggleMenu($, 'tools'),
    handoff: () => void showHandoff($),
    workflows: () => void runWorkflows($),
    toggleSettings: () => void toggleMenu($, 'settings'),
    setView: mode => void setView($, mode),
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
    showViewStatus($, view)
    // A load (a reload at a turn's end, a restart) sees no turn.complete for what came before: read it back.
    const earlier = finalReplies(await $.session.messages().catch(() => []))
    await update($, finals, list => earlier.reduce((acc, text) => addFinal(acc, text), list))
    await $.command.register({ name: 'taskview', description: 'Turn Task View on or off', argumentHint: '[on|off]' })
    await $.command.register({ name: 'cleanview', description: 'Turn Clean View on or off', argumentHint: '[on|off]' })
    await $.command.register({ name: 'handoff', description: 'Print a handoff brief for a fresh session and copy it' })
    startScan($)
    // Last, and caught: without the checklist tool the views still hide rows and the bar still runs.
    await $.tool.register(CHECKLIST_SPEC).catch(err => $.ui.log(`aitools: checklist tool not registered: ${errorText(err)}`))

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
      // Persisting is a nicety (survives reloads); it must never hold up the model request.
      await rememberCacheAt($, at).catch(() => undefined)
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
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

  // A view on: each new request starts a fresh checklist, and the note asks the model to keep it.
  on('prompt.submit', async ($, e, next) => {
    const note = viewNote(await read($, viewMode))
    if (note === null) {
      return next(e)
    }
    if (e.origin.kind !== 'plugin') {
      await update($, checklist, () => null)
    }

    return next({ ...e, context: [...(e.context ?? []), note] })
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
