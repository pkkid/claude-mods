import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EMPTY_ALERTS, checkAlerts } from '../src/alerts'
import type { AlertState } from '../src/alerts'
import { renderBar, renderSettings } from '../src/bar'
import { EMPTY_BURN, addSample, project } from '../src/burnrate'
import type { BurnState } from '../src/burnrate'
import { HANDOFF_PROMPT, MAX_CODE_CHARS, handoffOutput, parseHandoffOutput } from '../src/handoff'
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../src/settings'
import type { KeyStore } from '../src/settings'
import { scanMonth, sessionUsd } from '../src/transcripts'
import type { ScanCache, ScanIO } from '../src/transcripts'
import type { LimitWindow, Snapshot } from '../types'

// The engine follows `$` only into functions declared in this file, so every
// function that touches `$` lives here; src/ holds the pure units.

const snapshot = atom({ plugin: 'aicost', key: 'snapshot' } as const, null)
const month = atom({ plugin: 'aicost', key: 'month' } as const, { usd: 0, isEstimate: false, status: 'loading' })
const projection = atom({ plugin: 'aicost', key: 'projection' } as const, null)
const settings = atom({ plugin: 'aicost', key: 'settings' } as const, DEFAULT_SETTINGS)
const isSettingsOpen = atom({ plugin: 'aicost', key: 'isSettingsOpen' } as const, false)
const cacheAt = atom({ plugin: 'aicost', key: 'cacheAt' } as const, null)
const turnBaseline = atom({ plugin: 'aicost', key: 'turnBaseline' } as const, null)
const tick = atom({ plugin: 'aicost', key: 'tick' } as const, 0)
const isHandingOff = atom({ plugin: 'aicost', key: 'isHandingOff' } as const, false)

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
    $.ui.log(`aicost: monthly cost scan failed: ${errorText(err)}`)
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

/** Asks a fork of this conversation for the brief; copies it and toasts the outcome. Returns the chat row's text. */
async function handoff($: EngineInterface): Promise<string> {
  if (await read($, isHandingOff)) {
    return 'Handoff already in progress.'
  }
  await update($, isHandingOff, () => true)
  try {
    const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!reply.isAnswered) {
      const text = `Handoff failed: ${reply.reason === 'nothing-to-fork' ? 'nothing to hand off yet' : reply.reason}`
      $.ui.toast(text)
      return text
    }
    const brief = reply.text.trim()
    const copied = await $.ui.copy({ text: brief })
    $.ui.toast(copied.isCopied ? 'Handoff brief copied to the clipboard' : 'Handoff brief ready (copy failed)')

    return handoffOutput(brief)
  } catch (err) {
    const text = `Handoff failed: ${errorText(err)}`
    $.ui.toast(text)
    return text
  } finally {
    await update($, isHandingOff, () => false)
  }
}

async function fillHandoff($: EngineInterface): Promise<void> {
  const filled = await $.prompt.fill({ text: '/handoff' })
  if (!filled.isFilled) {
    $.ui.toast('Type /handoff to write a handoff brief')
  }
}

async function toggleSetting($: EngineInterface, key: keyof typeof DEFAULT_SETTINGS): Promise<void> {
  const changed = await update($, settings, s => {
    const was = normalizeSettings(s)

    return { ...was, [key]: !was[key] }
  })
  await saveSettings(storeOf($), normalizeSettings(changed))
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
    await $.command.register({ name: 'handoff', description: 'Print a handoff brief for a fresh session and copy it' })
    startScan($)

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

  // The brief is the command's output row: the chat renders it as markdown.
  on('command.run', { command: 'handoff' }, async $ => ({ text: await handoff($) }))

  // The stored row stays fenced markdown (what the model reads); on screen it is drawn as highlighted code.
  on('ui.render', { component: 'CommandOutput', props: { command: 'handoff' } }, async ($, e, next) => {
    const brief = e.props.isErrored ? null : parseHandoffOutput(e.props.text)
    if (brief === null || brief.length > MAX_CODE_CHARS) {
      return next(e)
    }
    const { Box, Text, Code } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text bold>Handoff brief</Text>
        <Code source={brief.replace(/\r/g, '')} language="markdown" />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    await read($, tick)
    const el = $.ui.resolve(e)
    const current = normalizeSettings(await read($, settings))

    if (await read($, isSettingsOpen)) {
      return renderSettings(el, current, {
        toggle: key => void toggleSetting($, key),
        close: () => void update($, isSettingsOpen, () => false),
      })
    }

    const view = {
      snapshot: await read($, snapshot),
      month: await read($, month),
      projection: await read($, projection),
      cacheAt: await read($, cacheAt),
      settings: current,
      now: await $.clock.now(),
    }
    const flags = { isWorking: e.props.isWorking, isHandingOff: await read($, isHandingOff) }

    return renderBar(el, view, flags, {
      // A plugin can't answer a command it runs itself (the engine skips the caller's hooks),
      // so the button stages /handoff in the prompt box for the person to send.
      handoff: () => void fillHandoff($),
      openSettings: () => void update($, isSettingsOpen, () => true),
    })
  })
}
