import type { Elements } from 'claude-code'

import { clockTime, duration, tokens, usd, weeklyReset } from './format'
import { usdSince } from './transcripts'
import { DOING_TEXT, VIEW_NAMES } from './checklist'
import type { renderChecklist } from './checklist'
import { MASCOT_HEIGHT, MASCOT_WIDTH } from './mascot'
import { TOGGLES } from './settings'
import type { MonthTotal, Settings, Snapshot, ToggleKey, ViewMode } from '../types'

export type View = {
  snapshot: Snapshot | null
  month: MonthTotal
  projection: number | null
  /** Start of the last main-thread model request, or null before one. */
  cacheAt: number | null
  settings: Settings
  now: number
}

export type Tone = 'warn' | 'danger' | undefined

/** One metric: `text` is the whole of it, `label` the leading word(s) naming it, drawn dimmer than the value after. */
export type Segment = { key: string; label: string; text: string; tone?: Tone }

export const SEPARATOR = '    '
/** Names the mod at the start of the bar; the `label` toggle hides it. */
export const LABEL = 'AI Tools'

/** Claude Code writes the main conversation's prompt cache with the 1-hour TTL; each request restarts it. */
export const CACHE_TTL = 60 * 60_000

const DASH = '—'
const MIN = 60_000
const CACHE_WARN = 10 * MIN
const TONE_COLORS = { warn: 'yellow', danger: 'red' } as const
/** Values in the checklist's half-dim grey: brighter than their dim labels, quieter than full text. */
const VALUE_COLOR = DOING_TEXT

export function toneFor(pct: number | undefined, settings: Settings): Tone {
  if (!settings.thresholdColors || pct === undefined) {
    return undefined
  }

  return pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : undefined
}

function cacheSegment(cacheAt: number | null, now: number, settings: Settings): Segment {
  if (cacheAt === null) {
    return { key: 'cache', label: 'cache', text: `cache ${DASH}` }
  }
  const left = cacheAt + CACHE_TTL - now
  const tone: Tone = !settings.thresholdColors ? undefined : left <= 0 ? 'danger' : left < CACHE_WARN ? 'warn' : undefined
  const text = left <= 0 ? 'cache cold' : `cache ${Math.max(1, Math.ceil(left / MIN))}m`

  return { key: 'cache', label: 'cache', text, tone }
}

function monthText(month: MonthTotal): string {
  if (month.status === 'loading') {
    return 'month …'
  }

  return month.status === 'error' ? 'month ?' : `month ${usd(month.usd, month.isEstimate)}`
}

const WEEK_MS = 7 * 24 * 60 * 60_000

/**
 * What 1% of the weekly allowance costs at API prices, estimated: this machine's spend since the weekly window opened
 * (its reset time less 7 days) over the weekly percent used. Null until both are known and above zero.
 */
export function usdPerWeeklyPercent(snapshot: Snapshot | null, month: MonthTotal): number | null {
  const weekly = snapshot?.weekly
  if (!weekly?.resetsAt || !(weekly.percentUsed > 0) || month.hours === undefined) {
    return null
  }
  const spent = usdSince(month.hours, Date.parse(weekly.resetsAt) - WEEK_MS)

  return spent > 0 ? spent / weekly.percentUsed : null
}

/** A share of the weekly allowance, with as many decimals as small shares need: `12%`, `2.1%`, `0.04%`, `<0.01%`. */
export function percentText(pct: number): string {
  if (pct < 0.01) {
    return '<0.01%'
  }

  return `${pct >= 10 ? Math.round(pct) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)}%`
}

/** The thread segment: its cost and the last turn's, each followed by its estimated share of the week when asked. */
function threadSegment(view: View): Segment | null {
  const { snapshot, settings: on } = view
  const thread = snapshot?.threadUsd
  const last = snapshot?.lastTurnUsd
  const perPercent = on.threadPercent ? usdPerWeeklyPercent(snapshot, view.month) : null
  const share = (spent: number | undefined) =>
    perPercent === null || spent === undefined ? null : `~${percentText(spent / perPercent)}`
  const threadShare = share(thread)
  const lastShare = on.lastTurnCost ? share(last) : null

  if (on.threadCost) {
    const turn = on.lastTurnCost && last !== undefined ? ` (+${usd(last)})` : ''
    const pct = threadShare === null ? '' : ` ${threadShare} wk${lastShare === null ? '' : ` (+${lastShare.slice(1)})`}`
    return { key: 'thread', label: 'thread', text: `thread ${thread === undefined ? DASH : usd(thread)}${turn}${pct}` }
  }
  if (on.lastTurnCost) {
    return { key: 'thread', label: 'last', text: `last ${last === undefined ? DASH : usd(last)}${lastShare === null ? '' : ` ${lastShare} wk`}` }
  }
  if (threadShare !== null) {
    return { key: 'thread', label: 'thread', text: `thread ${threadShare} wk` }
  }

  return null
}

/** The token segment: the thread's total and the last turn's in parentheses, as the cost segment shows dollars. */
function tokenSegment(snapshot: Snapshot | null, on: Settings): Segment {
  const count = (n: number | undefined) => (n === undefined ? DASH : tokens(n))
  if (on.threadTokens) {
    const turn = on.lastTurnTokens && snapshot?.lastTurnTokens !== undefined ? ` (+${tokens(snapshot.lastTurnTokens)})` : ''
    return { key: 'tokens', label: 'tok', text: `tok ${count(snapshot?.threadTokens)}${turn}` }
  }

  return { key: 'tokens', label: 'last tok', text: `last tok ${count(snapshot?.lastTurnTokens)}` }
}

export function segments(view: View): Segment[] {
  const { snapshot, settings: on, now } = view
  const segs: Segment[] = []
  const fiveHour = snapshot?.fiveHour
  const weekly = snapshot?.weekly
  const context = snapshot?.context
  const pct = (n: number | undefined) => (n === undefined ? DASH : `${Math.round(n)}%`)

  if (on.fiveHour) {
    const reset = on.resets && fiveHour?.resetsAt ? `, ${duration(Date.parse(fiveHour.resetsAt) - now)}` : ''
    segs.push({ key: 'fiveHour', label: '5h', text: `5h ${pct(fiveHour?.percentUsed)}${reset}`, tone: toneFor(fiveHour?.percentUsed, on) })
  }
  if (on.weekly) {
    const reset = on.resets && weekly?.resetsAt ? `, ${weeklyReset(weekly.resetsAt, now)}` : ''
    segs.push({ key: 'weekly', label: 'wk', text: `wk ${pct(weekly?.percentUsed)}${reset}`, tone: toneFor(weekly?.percentUsed, on) })
  }
  if (on.contextPercent || on.contextTokens) {
    const parts: string[] = []
    if (on.contextPercent) {
      parts.push(pct(context?.percent))
    }
    if (on.contextTokens && context?.tokens !== undefined) {
      parts.push(`${tokens(context.tokens)}/${tokens(context.window)}`)
    } else if (on.contextTokens && !on.contextPercent) {
      parts.push(DASH)
    }
    segs.push({ key: 'context', label: 'ctx', text: `ctx ${parts.join(' ')}`, tone: toneFor(context?.percent, on) })
  }
  if (on.threadTokens || on.lastTurnTokens) {
    segs.push(tokenSegment(snapshot, on))
  }
  if (on.cacheWarmth) {
    segs.push(cacheSegment(view.cacheAt, now, on))
  }
  const threadSeg = threadSegment(view)
  if (threadSeg !== null) {
    segs.push(threadSeg)
  }
  if (on.monthlyCost) {
    segs.push({ key: 'month', label: 'month', text: monthText(view.month) })
  }
  if (on.burnRate && view.projection !== null) {
    segs.push({ key: 'burn', label: 'limit', text: `limit ~${clockTime(view.projection)}` })
  }

  return segs
}

/** `Svg` only where the surface draws it (the desktop): the mascot and its option show there alone. */
type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Svg?: Elements['desktop']['Svg'] }

/** The 🛠 menu's view options; picking the one that is on turns it off. */
const VIEWS = [
  { mode: 'task', label: VIEW_NAMES.task },
  { mode: 'clean', label: VIEW_NAMES.clean },
] as const

/** How many display options the ⁝ menu puts on one row. */
const SETTINGS_PER_ROW = 5

/** Quiet buttons, matching the other bands: dim text and no outline at rest, full strength under the pointer. */
const QUIET = { plain: true, dimColor: true } as const

export function renderBar(
  el: El,
  view: View,
  flags: {
    isWorking: boolean
    isHandingOff: boolean
    isToolsOpen: boolean
    isSettingsOpen: boolean
    viewMode: ViewMode
    /** The mascot's drawing as it stands now. */
    mascot: { source: string; alt: string } | null
  },
  on: {
    toggleTools(): void
    handoff(): void
    openNotes(): void
    setView(mode: ViewMode): void
    openDock(): void
    toggleSettings(): void
    toggle(key: ToggleKey): void
  },
  checklist: ReturnType<typeof renderChecklist> = null,
) {
  const { Box, Text, Button, Svg } = el
  const isHandoffIdle = !flags.isWorking && !flags.isHandingOff
  const segs = segments(view)

  const art = Svg && view.settings.mascot ? flags.mascot : null

  // Segments wrap onto further rows when the band is narrow; the mascot and the buttons keep their places at the ends.
  // Beside the mascot the row centers on him; without him the buttons stay on the first row of text.
  const bar = (
    <Box flexDirection="row" justifyContent="space-between" {...(art ? { alignItems: 'center' as const } : {})}>
      {Svg && art && (
        <Box key="mascot-art" flexShrink={0} marginRight={1}>
          <Svg source={art.source} alt={art.alt} width={MASCOT_WIDTH} height={MASCOT_HEIGHT} />
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1}>
        {view.settings.label && (
          <Text key="label" dimColor>
            {LABEL}
            {segs.length > 0 ? SEPARATOR : ''}
          </Text>
        )}
        {segs.map((s, i) => (
          // Label and value in one row, so a narrow band wraps between metrics, never inside one.
          <Box key={`segment-${s.key}`} flexDirection="row">
            <Text dimColor>{`${s.label} `}</Text>
            <Text color={s.tone ? TONE_COLORS[s.tone] : VALUE_COLOR}>
              {s.text.slice(s.label.length + 1)}
              {i < segs.length - 1 ? SEPARATOR : ''}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row" gap={0} flexShrink={0}>
        <Button key="tools" label="🛠" {...QUIET} onPress={() => on.toggleTools()} />
        <Button key="settings" label="⁝" {...QUIET} onPress={() => on.toggleSettings()} />
      </Box>
    </Box>
  )

  let menu = null
  if (flags.isSettingsOpen) {
    // At most SETTINGS_PER_ROW options to a row; a narrow band still wraps a row further.
    // The desktop's own options (Mascot) lead the first row, on top of its usual count.
    const shared = TOGGLES.filter(t => !t.needsSvg)
    const rows = Array.from({ length: Math.ceil(shared.length / SETTINGS_PER_ROW) }, (_, i) =>
      shared.slice(i * SETTINGS_PER_ROW, (i + 1) * SETTINGS_PER_ROW),
    )
    if (Svg) {
      rows[0] = [...TOGGLES.filter(t => t.needsSvg), ...(rows[0] ?? [])]
    }
    menu = (
      <Box flexDirection="column">
        {rows.map((row, i) => (
          <Box key={`settings-row-${i}`} flexDirection="row" flexWrap="wrap" justifyContent="flex-end" columnGap={2}>
            {row.map(t => (
              <Button key={t.key} label={`${view.settings[t.key] ? '●' : '○'} ${t.label}`} {...QUIET} onPress={() => on.toggle(t.key)} />
            ))}
          </Box>
        ))}
      </Box>
    )
  } else if (flags.isToolsOpen) {
    menu = (
      <Box flexDirection="row" justifyContent="flex-end" gap={0}>
        <Button
          key="handoff"
          label={flags.isHandingOff ? 'Handoff…' : 'Handoff'}
          {...QUIET}
          onPress={() => isHandoffIdle && on.handoff()}
        />
        <Button key="notes" label="Notes" {...QUIET} onPress={() => on.openNotes()} />
        <Button key="subagents" label="Subagents" {...QUIET} onPress={() => on.openDock()} />
        {VIEWS.map(v => (
          <Button
            key={v.mode}
            label={`${flags.viewMode === v.mode ? '●' : '○'} ${v.label}`}
            {...QUIET}
            onPress={() => on.setView(flags.viewMode === v.mode ? 'off' : v.mode)}
          />
        ))}
      </Box>
    )
  }
  if (!menu && !checklist) {
    return bar
  }

  // An open menu (🛠 or ⁝) sits above the bar and the checklist below it, so the bar itself never shifts.
  return (
    <Box flexDirection="column" gap={1}>
      {menu}
      {bar}
      {checklist}
    </Box>
  )
}
