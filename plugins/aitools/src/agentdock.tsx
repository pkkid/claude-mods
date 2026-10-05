import type { Elements } from 'claude-code'

import type { AgentCard, AgentRun, HelperMode, TeamSize } from '../types'
import { BLUE, DOING_TEXT, GREEN, progressBar } from './checklist'
import { elapsed } from './format'

export const TEAM_SIZES = [1, 3, 5, 10, 20, 30] as const
/** Teams larger than this get a warning: they use Claude usage much faster. */
export const LARGE_TEAM = 10
export const HELPER_LABELS = { fast: 'Fast & cheap', same: 'Same as chat' } as const
/** What Fast & cheap helpers run on, and how hard they think. */
export const FAST_MODEL = 'claude-sonnet-5-5'
export const FAST_EFFORT = 'low'

export const PROGRESS_TOOL = 'agent_progress'
export const PROGRESS_TOOL_ID = 'mcp__aitools__agent_progress'
export const DOCK_PANE = 'agentdock'

export const PROGRESS_SPEC = {
  name: PROGRESS_TOOL,
  description:
    'For a helper agent on an Agent Dock team: reports what you are doing and how far along your task is, shown on ' +
    'your card in the dock. Call it when you start, about every quarter of your work, and at 100 when done.',
  inputSchema: {
    type: 'object',
    properties: {
      doing: { type: 'string', description: 'What you are doing now, in a few plain words' },
      percent: { type: 'number', minimum: 0, maximum: 100, description: 'Your estimate of how far along your task is' },
    },
    required: ['doing', 'percent'],
  },
}

/** The hidden note the main prompt carries while the dock is open. */
export function dockNote(team: TeamSize): string {
  const most = team === 1 ? 'one helper agent' : `up to ${team} helper agents at once`

  return (
    `Agent Dock is on: the person picked a team of ${team} helper agent${team === 1 ? '' : 's'} for this request. ` +
    `If the job has parts that can be done separately, split it into pieces and hand them to ${most} with the ` +
    'Agent tool, starting several in one message so they run in parallel. Give each a short description (it is the ' +
    'title of its card in the dock) and a self-contained prompt. If a start is refused because the team is busy, ' +
    'start that piece again once a helper finishes. When every helper is done, combine their results into one reply.'
  )
}

/** What each helper's prompt gains, so its card can show progress. */
export const HELPER_NOTE =
  `\n\n(You are one helper on an Agent Dock team. Report progress with ${PROGRESS_TOOL_ID}: call it when you ` +
  'start with a few words on what you are doing and percent 0, again about every quarter of your work, and with ' +
  'percent 100 when you finish.)'

export function isTeamSize(n: unknown): n is TeamSize {
  return TEAM_SIZES.some(size => size === n)
}

export function newRun(now: number): AgentRun {
  return { startedAt: now, cards: [], queued: [] }
}

/** The run with a started helper's card, its piece no longer queued. */
export function addCard(run: AgentRun, id: string, task: string, now: number): AgentRun {
  const card: AgentCard = { id, task, status: 'running', startedAt: now }

  return { ...run, cards: [...run.cards, card], queued: run.queued.filter(q => q !== task) }
}

/** The run with a refused piece waiting for a free helper (once per description). */
export function queuePiece(run: AgentRun, task: string): AgentRun {
  return run.queued.includes(task) ? run : { ...run, queued: [...run.queued, task] }
}

/** The run with one helper's reported progress; a percent is rounded and held to 0 to 100. */
export function reportProgress(run: AgentRun, id: string, doing: string, percent: number): AgentRun {
  const pct = Math.min(100, Math.max(0, Math.round(Number.isFinite(percent) ? percent : 0)))

  const report = (c: AgentCard): AgentCard => ({ ...c, doing: doing.trim() || c.doing, percent: pct })

  return { ...run, cards: run.cards.map(c => (c.id === id ? report(c) : c)) }
}

/** The run with a helper finished: done when it answered, failed otherwise. */
export function finishCard(run: AgentRun, id: string, isAnswered: boolean, now: number): AgentRun {
  const status = isAnswered ? 'done' : 'failed'

  return { ...run, cards: run.cards.map(c => (c.id === id ? { ...c, status, endedAt: now } : c)) }
}

export function isRunning(run: AgentRun | null): boolean {
  return run !== null && run.cards.some(c => c.status === 'running')
}

/** The dock's header line: team size, then the non-zero counts. */
export function headerText(run: AgentRun | null, team: TeamSize): string {
  const cards = run?.cards ?? []
  const working = cards.filter(c => c.status === 'running').length
  const done = cards.filter(c => c.status === 'done').length
  const failed = cards.filter(c => c.status === 'failed').length
  const parts = [`${team} agent${team === 1 ? '' : 's'}`]
  const counts: [number, string][] = [
    [working, 'working'],
    [Math.max(0, team - working), 'idle'],
    [run?.queued.length ?? 0, 'queued'],
    [done, 'done'],
    [failed, 'failed'],
  ]
  for (const [n, label] of counts) {
    if (n > 0) parts.push(`${n} ${label}`)
  }

  return parts.join(' · ')
}

/** The line under a finished run's cards: how many helpers finished, how many failed, and how long they took. */
export function finishLine(run: AgentRun, now: number): string {
  // Seconds as words while every helper took under a minute (`6 to 10 seconds`), else `m:ss` (`0:40 to 1:20`).
  const times = run.cards.map(c => Math.max(0, (c.endedAt ?? now) - c.startedAt))
  const [low, high] = [Math.min(...times), Math.max(...times)]
  const [lowS, highS] = [Math.round(low / 1000), Math.round(high / 1000)]
  const span =
    highS < 60
      ? lowS === highS
        ? `in ${highS} second${highS === 1 ? '' : 's'}`
        : `in ${lowS} to ${highS} seconds`
      : elapsed(low) === elapsed(high)
        ? `in ${elapsed(high)}`
        : `in ${elapsed(low)} to ${elapsed(high)}`
  const failed = run.cards.filter(c => c.status === 'failed').length
  const n = run.cards.length
  if (failed === 0) {
    return n === 1 ? `The helper finished ${span}.` : `All ${n} helpers finished ${span} each.`
  }

  return `${n - failed} of ${n} helpers finished and ${failed} failed, ${span} each.`
}

type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const QUIET = { plain: true, dimColor: true } as const
const CARD_COLORS = { running: BLUE, done: GREEN, failed: 'red' } as const
const CARD_MARKS = { running: '●', done: '✓', failed: '✕' } as const

/**
 * The dock pane: controls on top, a size warning, then the header and a card per helper; once the job is done and
 * Claude has replied, a line under the cards says how long the helpers took, until the next request.
 */
export function renderDock(
  el: El,
  dock: { team: TeamSize; helpers: HelperMode; run: AgentRun | null; now: number },
  on: { setTeam(size: TeamSize): void; setHelpers(mode: HelperMode): void },
) {
  const { Box, Text, Button } = el
  const { team, helpers, run, now } = dock

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>Team size:</Text>
          {TEAM_SIZES.map(size => (
            <Button
              key={`team-${size}`}
              label={`${team === size ? '●' : '○'} ${size}`}
              {...QUIET}
              onPress={() => on.setTeam(size)}
            />
          ))}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>Helpers:</Text>
          {(['fast', 'same'] as const).map(mode => (
            <Button
              key={`helpers-${mode}`}
              label={`${helpers === mode ? '●' : '○'} ${HELPER_LABELS[mode]}`}
              {...QUIET}
              onPress={() => on.setHelpers(mode)}
            />
          ))}
        </Box>
      </Box>
      {team > LARGE_TEAM && (
        <Text color="yellow">{`⚠ A team of ${team} uses your Claude usage much faster.`}</Text>
      )}
      {run === null || run.cards.length === 0 ? (
        <Text dimColor>
          {`Your next prompt can hand work to ${team} ${HELPER_LABELS[helpers]} helper${team === 1 ? '' : 's'}.`}
        </Text>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>{headerText(run, team)}</Text>
          {run.cards.map(card => renderCard(el, card, now))}
          {run.isReported && (
            <Box marginTop={1}>
              <Text dimColor>{finishLine(run, now)}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

/** One helper's row: its mark and task (and what it is doing), then percent, bar and time. */
function renderCard(el: El, card: AgentCard, now: number) {
  const { Box, Text } = el
  const percent = card.status === 'done' ? 100 : (card.percent ?? 0)
  const bar = progressBar(percent)
  const color = CARD_COLORS[card.status]
  const isActive = card.status === 'running'

  return (
    <Box key={`agent-${card.id}`} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" flexShrink={1}>
        <Text color={color}>{`${CARD_MARKS[card.status]} `}</Text>
        <Text color={isActive ? DOING_TEXT : undefined} dimColor={!isActive} wrap="truncate-end">
          {card.task}
          {isActive && card.doing ? ` · ${card.doing}` : ''}
        </Text>
      </Box>
      <Box flexDirection="row" flexShrink={0}>
        <Text dimColor>{` ${String(percent).padStart(3)}% `}</Text>
        <Text color={color} dimColor={!isActive}>{bar.filled}</Text>
        <Text dimColor>{bar.empty}</Text>
        <Text dimColor>{` ${elapsed((card.endedAt ?? now) - card.startedAt).padStart(5)}`}</Text>
      </Box>
    </Box>
  )
}
