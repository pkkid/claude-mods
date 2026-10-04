import type { Elements } from 'claude-code'

import { clockTime, duration, tokens, usd, weeklyReset } from './format'
import { TOGGLES } from './settings'
import type { MonthTotal, Settings, Snapshot, ToggleKey } from '../types'

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

export const SEPARATOR = ' │ '

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

export function renderBar(
  el: El,
  view: View,
  flags: { isWorking: boolean; isHandingOff: boolean },
  on: { handoff(): void; openSettings(): void },
) {
  const { Box, Text, Button } = el
  const isHandoffIdle = !flags.isWorking && !flags.isHandingOff
  const segs = segments(view)

  // Segments wrap onto further rows when the band is narrow; the buttons keep their place on the right.
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1}>
        {segs.map((s, i) => (
          <Text key={s.key} color={s.tone ? TONE_COLORS[s.tone] : undefined} dimColor={!s.tone}>
            {s.text}
            {i < segs.length - 1 ? SEPARATOR : ''}
          </Text>
        ))}
      </Box>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        {view.settings.handoffButton && (
          <Button
            key="handoff"
            label={flags.isHandingOff ? 'Handoff…' : 'Handoff'}
            dimColor={!isHandoffIdle}
            onPress={() => isHandoffIdle && on.handoff()}
          />
        )}
        <Button key="settings" label="..." onPress={() => on.openSettings()} />
      </Box>
    </Box>
  )
}

export function renderSettings(el: El, settings: Settings, on: { toggle(key: ToggleKey): void; close(): void }) {
  const { Box, Text, Button } = el

  return (
    <Box flexDirection="column">
      <Text bold>aicost settings</Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {TOGGLES.map(t => (
          <Button key={t.key} label={`[${settings[t.key] ? '✓' : ' '}] ${t.label}`} plain onPress={() => on.toggle(t.key)} />
        ))}
      </Box>
      <Box flexDirection="row" justifyContent="flex-end">
        <Button key="done" label="Done" variant="primary" onPress={() => on.close()} />
      </Box>
    </Box>
  )
}
