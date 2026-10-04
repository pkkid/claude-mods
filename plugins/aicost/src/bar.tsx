import type { Elements, RenderSurface } from 'claude-code'

import { clockTime, duration, tokens, usd, weeklyReset } from './format'
import { TOGGLES } from './settings'
import type { MonthTotal, Settings, Snapshot, ToggleKey } from '../types'

export type View = { snapshot: Snapshot | null; month: MonthTotal; projection: number | null; settings: Settings; now: number }

export type Tone = 'warn' | 'danger' | undefined

/** Higher priority is kept longer when the bar is too narrow. */
export type Segment = { key: string; text: string; tone?: Tone; priority: number }

export const SEPARATOR = ' │ '

const DASH = '—'
const TONE_COLORS = { warn: 'yellow', danger: 'red' } as const

export function toneFor(pct: number | undefined, settings: Settings): Tone {
  if (!settings.thresholdColors || pct === undefined) {
    return undefined
  }

  return pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : undefined
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
    segs.push({ key: 'fiveHour', text: `5h ${pct(fiveHour?.percentUsed)}${reset}`, tone: toneFor(fiveHour?.percentUsed, on), priority: 7 })
  }
  if (on.weekly) {
    const reset = on.resets && weekly?.resetsAt ? ` ·${weeklyReset(weekly.resetsAt, now)}` : ''
    segs.push({ key: 'weekly', text: `wk ${pct(weekly?.percentUsed)}${reset}`, tone: toneFor(weekly?.percentUsed, on), priority: 6 })
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
    segs.push({ key: 'context', text: `ctx ${parts.join(' ')}`, tone: toneFor(context?.percent, on), priority: on.contextPercent ? 5 : 4 })
  }
  const last = snapshot?.lastTurnUsd
  if (on.threadCost) {
    const thread = snapshot?.threadUsd === undefined ? DASH : usd(snapshot.threadUsd)
    const turn = on.lastTurnCost && last !== undefined ? ` (+${usd(last)})` : ''
    segs.push({ key: 'thread', text: `thread ${thread}${turn}`, priority: 3 })
  } else if (on.lastTurnCost) {
    segs.push({ key: 'thread', text: `last ${last === undefined ? DASH : usd(last)}`, priority: 3 })
  }
  if (on.monthlyCost) {
    segs.push({ key: 'month', text: monthText(view.month), priority: 2 })
  }
  if (on.burnRate && view.projection !== null) {
    segs.push({ key: 'burn', text: `limit ~${clockTime(view.projection)}`, priority: 1 })
  }

  return segs
}

function width(segs: Segment[]): number {
  return segs.reduce((sum, s) => sum + s.text.length, 0) + Math.max(0, segs.length - 1) * SEPARATOR.length
}

export function fit(segs: Segment[], columns: number, reserved: number): Segment[] {
  let kept = segs
  while (kept.length > 0 && width(kept) + reserved > columns) {
    const lowest = Math.min(...kept.map(s => s.priority))
    kept = kept.filter(s => s.priority !== lowest)
  }

  return kept
}

type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export function renderBar(
  el: El,
  view: View,
  flags: { isWorking: boolean; isHandingOff: boolean; columns: number },
  on: { handoff(): void; openSettings(): void },
) {
  const { Box, Text, Button } = el
  const showHandoff = view.settings.handoffButton
  const isHandoffIdle = !flags.isWorking && !flags.isHandingOff
  const handoffLabel = flags.isHandingOff ? 'Handoff…' : 'Handoff'
  const reserved = 2 + (showHandoff ? handoffLabel.length + 5 : 0) + 6
  const segs = fit(segments(view), flags.columns, reserved)

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" flexShrink={1}>
        {segs.map((s, i) => (
          <Text key={s.key} color={s.tone ? TONE_COLORS[s.tone] : undefined} dimColor={!s.tone} wrap="truncate">
            {i > 0 ? SEPARATOR : ''}
            {s.text}
          </Text>
        ))}
      </Box>
      <Box flexDirection="row" gap={1}>
        {showHandoff && (
          <Button key="handoff" label={handoffLabel} dimColor={!isHandoffIdle} onPress={() => isHandoffIdle && on.handoff()} />
        )}
        <Button key="settings" label="⚙" onPress={() => on.openSettings()} />
      </Box>
    </Box>
  )
}

/** A checkbox glyph on surfaces that draw native buttons; bracket text on the terminal. */
function checkbox(isOn: boolean, surface: RenderSurface): string {
  if (surface === 'terminal') {
    return isOn ? '[x]' : '[ ]'
  }

  return isOn ? '☑' : '☐'
}

export function renderSettings(
  el: El,
  settings: Settings,
  surface: RenderSurface,
  on: { toggle(key: ToggleKey): void; close(): void },
) {
  const { Box, Text, Button } = el

  return (
    <Box flexDirection="column">
      <Text bold>aicost settings</Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {TOGGLES.map(t => (
          <Button key={t.key} label={`${checkbox(settings[t.key], surface)} ${t.label}`} plain onPress={() => on.toggle(t.key)} />
        ))}
      </Box>
      <Box flexDirection="row" justifyContent="flex-end">
        <Button key="done" label="Done" variant="primary" onPress={() => on.close()} />
      </Box>
    </Box>
  )
}
