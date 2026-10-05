import type { Elements } from 'claude-code'

import { clockTime, duration, tokens, usd, weeklyReset } from './format'
import { VIEW_NAMES } from './checklist'
import type { renderChecklist } from './checklist'
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

export type Segment = { key: string; text: string; tone?: Tone }

export const SEPARATOR = '    '
/** Names the mod at the start of the bar; the `label` toggle hides it. */
export const LABEL = 'AI Tools'

/** Claude Code writes the main conversation's prompt cache with the 1-hour TTL; each request restarts it. */
export const CACHE_TTL = 60 * 60_000

const DASH = '—'
const MIN = 60_000
const CACHE_WARN = 10 * MIN
const TONE_COLORS = { warn: 'yellow', danger: 'red' } as const

export function toneFor(pct: number | undefined, settings: Settings): Tone {
  if (!settings.thresholdColors || pct === undefined) {
    return undefined
  }

  return pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : undefined
}

function cacheSegment(cacheAt: number | null, now: number, settings: Settings): Segment {
  if (cacheAt === null) {
    return { key: 'cache', text: `cache ${DASH}` }
  }
  const left = cacheAt + CACHE_TTL - now
  const tone: Tone = !settings.thresholdColors ? undefined : left <= 0 ? 'danger' : left < CACHE_WARN ? 'warn' : undefined
  const text = left <= 0 ? 'cache cold' : `cache ${Math.max(1, Math.ceil(left / MIN))}m`

  return { key: 'cache', text, tone }
}

function monthText(month: MonthTotal): string {
  if (month.status === 'loading') {
    return 'month …'
  }

  return month.status === 'error' ? 'month ?' : `month ${usd(month.usd, month.isEstimate)}`
}

export function segments(view: View): Segment[] {
  const { snapshot, settings: on, now } = view
  const segs: Segment[] = []
  const fiveHour = snapshot?.fiveHour
  const weekly = snapshot?.weekly
  const context = snapshot?.context
  const pct = (n: number | undefined) => (n === undefined ? DASH : `${Math.round(n)}%`)

  if (on.fiveHour) {
    const reset = on.resets && fiveHour?.resetsAt ? ` ·${duration(Date.parse(fiveHour.resetsAt) - now)}` : ''
    segs.push({ key: 'fiveHour', text: `5h ${pct(fiveHour?.percentUsed)}${reset}`, tone: toneFor(fiveHour?.percentUsed, on) })
  }
  if (on.weekly) {
    const reset = on.resets && weekly?.resetsAt ? ` ·${weeklyReset(weekly.resetsAt, now)}` : ''
    segs.push({ key: 'weekly', text: `wk ${pct(weekly?.percentUsed)}${reset}`, tone: toneFor(weekly?.percentUsed, on) })
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
    segs.push({ key: 'context', text: `ctx ${parts.join(' ')}`, tone: toneFor(context?.percent, on) })
  }
  if (on.cacheWarmth) {
    segs.push(cacheSegment(view.cacheAt, now, on))
  }
  const last = snapshot?.lastTurnUsd
  if (on.threadCost) {
    const thread = snapshot?.threadUsd === undefined ? DASH : usd(snapshot.threadUsd)
    const turn = on.lastTurnCost && last !== undefined ? ` (+${usd(last)})` : ''
    segs.push({ key: 'thread', text: `thread ${thread}${turn}` })
  } else if (on.lastTurnCost) {
    segs.push({ key: 'thread', text: `last ${last === undefined ? DASH : usd(last)}` })
  }
  if (on.monthlyCost) {
    segs.push({ key: 'month', text: monthText(view.month) })
  }
  if (on.burnRate && view.projection !== null) {
    segs.push({ key: 'burn', text: `limit ~${clockTime(view.projection)}` })
  }

  return segs
}

type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

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
  flags: { isWorking: boolean; isHandingOff: boolean; isToolsOpen: boolean; isSettingsOpen: boolean; viewMode: ViewMode },
  on: {
    toggleTools(): void
    handoff(): void
    workflows(): void
    setView(mode: ViewMode): void
    toggleSettings(): void
    toggle(key: ToggleKey): void
  },
  checklist: ReturnType<typeof renderChecklist> = null,
) {
  const { Box, Text, Button } = el
  const isHandoffIdle = !flags.isWorking && !flags.isHandingOff
  const segs = segments(view)

  // Segments wrap onto further rows when the band is narrow; the buttons keep their place on the right.
  const bar = (
    <Box flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1}>
        {view.settings.label && (
          <Text key="label" dimColor>
            {LABEL}
            {segs.length > 0 ? SEPARATOR : ''}
          </Text>
        )}
        {segs.map((s, i) => (
          <Text key={s.key} color={s.tone ? TONE_COLORS[s.tone] : undefined} dimColor={!s.tone}>
            {s.text}
            {i < segs.length - 1 ? SEPARATOR : ''}
          </Text>
        ))}
      </Box>
      <Box flexDirection="row" gap={0} flexShrink={0}>
        {view.settings.handoffButton && <Button key="tools" label="🛠" {...QUIET} onPress={() => on.toggleTools()} />}
        <Button key="settings" label="⁝" {...QUIET} onPress={() => on.toggleSettings()} />
      </Box>
    </Box>
  )

  let menu = null
  if (flags.isSettingsOpen) {
    // At most SETTINGS_PER_ROW options to a row; a narrow band still wraps a row further.
    const rows = Array.from({ length: Math.ceil(TOGGLES.length / SETTINGS_PER_ROW) }, (_, i) =>
      TOGGLES.slice(i * SETTINGS_PER_ROW, (i + 1) * SETTINGS_PER_ROW),
    )
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
  } else if (flags.isToolsOpen && view.settings.handoffButton) {
    menu = (
      <Box flexDirection="row" justifyContent="flex-end" gap={0}>
        <Button
          key="handoff"
          label={flags.isHandingOff ? 'Handoff…' : 'Handoff'}
          {...QUIET}
          onPress={() => isHandoffIdle && on.handoff()}
        />
        <Button key="workflows" label="Workflows" {...QUIET} onPress={() => on.workflows()} />
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
