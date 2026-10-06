import type { Elements } from 'claude-code'

import type { AgentCard, AgentKind, AgentRun, AgentShowing, HelperMode, HideAfter, TeamPick, TeamSize } from '../types'
import { BLUE, DOING_TEXT, FAINT_TEXT, progressBar } from './checklist'
import { ago, elapsed } from './format'

export const TEAM_SIZES = [3, 5, 10, 20, 30] as const
/** The team picks the pane offers: Default first, which changes nothing about subagents, then the sizes. */
export const TEAM_PICKS = ['default', ...TEAM_SIZES] as const
/** How many finished subagents the pane keeps listing, newest first out of view last. */
export const FINISHED_KEEP = 50
/** Teams larger than this get a warning: they use Claude usage much faster. */
export const LARGE_TEAM = 10
export const HELPER_LABELS = { same: 'Same as chat', fast: 'Fast & cheap' } as const
export const SHOWING_LABELS = { all: 'All', tool: 'Tool agents', current: 'Current task' } as const
/** The Hide completed picks: never, then the longest wait to the shortest, in minutes. */
export const HIDE_AFTER = ['never', 15, 5, 1, 0] as const
export const DEFAULT_HIDE_AFTER: HideAfter = 'never'

export function hideAfterLabel(minutes: HideAfter): string {
  return minutes === 'never' ? 'Never' : minutes === 0 ? 'Immediate' : `${minutes}m`
}

export function isShowing(value: unknown): value is AgentShowing {
  return value === 'all' || value === 'tool' || value === 'current'
}

export function isHideAfter(value: unknown): value is HideAfter {
  return HIDE_AFTER.some(m => m === value)
}

/**
 * The lines the pane's picks leave: workflow agents only under All, only those started since the last prompt under
 * Current task (all of them before any prompt), and finished ones until Hide completed's time is up (if
 * ever).
 */
export function visibleCards(
  cards: readonly AgentCard[],
  view: { showing: AgentShowing; hideAfter: HideAfter; requestAt: number | null; now: number },
): AgentCard[] {
  return cards.filter(
    c =>
      (view.showing !== 'tool' || c.kind !== 'workflow') &&
      (view.showing !== 'current' || view.requestAt === null || c.startedAt >= view.requestAt) &&
      (c.status === 'running' || view.hideAfter === 'never' || view.now - (c.endedAt ?? view.now) < view.hideAfter * 60_000),
  )
}
/** What Fast & cheap helpers run on, and how hard they think. */
export const FAST_MODEL = 'claude-sonnet-5-5'
export const FAST_EFFORT = 'low'

export const PROGRESS_TOOL = 'agent_progress'
export const PROGRESS_TOOL_ID = 'mcp__aitools__agent_progress'
export const DOCK_PANE = 'subagents'

export const PROGRESS_SPEC = {
  name: PROGRESS_TOOL,
  description:
    'For a helper agent on a Subagents team: reports what you are doing and how far along your task is, shown on ' +
    'your card in the Subagents pane. Call it when you start, about every quarter of your work, and at 100 when done.',
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
  return (
    `The Subagents pane is open: the person picked a team of ${team} helper agents for this request. ` +
    'If the job has parts that can be done separately, split it into pieces and hand them to ' +
    `up to ${team} helper agents at once with the Agent tool, starting several in one message so they run in ` +
    'parallel. Give each a short description (it is the title of its card in the Subagents pane) and a ' +
    'self-contained prompt. If a start is refused because the team is busy, start that piece again once a helper ' +
    'finishes. When every helper is done, combine their results into one reply.'
  )
}

/** What each helper's prompt gains, so its card can show progress. */
export const HELPER_NOTE =
  `\n\n(You are one helper on a Subagents team. Report progress with ${PROGRESS_TOOL_ID}: call it when you ` +
  'start with a few words on what you are doing and percent 0, again about every quarter of your work, and with ' +
  'percent 100 when you finish.)'

export function isTeamSize(n: unknown): n is TeamSize {
  return TEAM_SIZES.some(size => size === n)
}

export function isTeamPick(n: unknown): n is TeamPick {
  return n === 'default' || isTeamSize(n)
}

export function newRun(now: number): AgentRun {
  return { startedAt: now, cards: [], queued: [] }
}

/** The run with a started helper's card, its piece no longer queued. */
export function addCard(run: AgentRun, id: string, task: string, now: number, kind: AgentKind = 'helper'): AgentRun {
  if (run.cards.some(c => c.id === id)) {
    return run
  }
  const card: AgentCard = { id, task, kind, status: 'running', startedAt: now }

  return { ...run, cards: [...run.cards, card], queued: run.queued.filter(q => q !== task) }
}

/** The run with a subagent's latest activity on its line; a helper's own progress report is left as it is. */
export function noteActivity(run: AgentRun, id: string, doing: string): AgentRun {
  return { ...run, cards: run.cards.map(c => (c.id === id && c.kind !== 'helper' && c.kind !== undefined ? { ...c, doing } : c)) }
}

/** The last part of a path: what a line names a file by. */
function baseName(path: unknown): string {
  return typeof path === 'string' ? (path.split('/').filter(Boolean).at(-1) ?? path) : ''
}

/** A short line on what a tool call does, for a subagent's line: `Reading bar.tsx`, `Running npm test`. */
export function activityText(tool: string, input: Record<string, unknown>): string {
  const clip = (text: unknown, n = 40) => {
    const one = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
    return one.length > n ? `${one.slice(0, n - 1)}…` : one
  }
  switch (tool) {
    case 'Read':
      return `Reading ${baseName(input.file_path)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${baseName(input.file_path ?? input.notebook_path)}`
    case 'Write':
      return `Writing ${baseName(input.file_path)}`
    case 'Bash':
      return `Running ${clip(input.command)}`
    case 'Grep':
      return `Searching for ${clip(input.pattern, 30)}`
    case 'Glob':
      return `Finding ${clip(input.pattern, 30)}`
    case 'WebFetch':
      return `Fetching ${clip(typeof input.url === 'string' ? input.url.replace(/^https?:\/\//, '') : '', 30)}`
    case 'WebSearch':
      return `Searching the web for ${clip(input.query, 30)}`
    case 'Agent':
      return `Starting ${clip(input.description, 30) || 'a subagent'}`
    default:
      return `Using ${tool.replace(/^mcp__[^_]+__/, '')}`
  }
}

/** A workflow's name, for its agents' lines: the tool's `name`, else its script's `meta` name. */
export function workflowName(input: Record<string, unknown>): string {
  if (typeof input.name === 'string' && input.name) {
    return input.name
  }
  const script = typeof input.script === 'string' ? input.script : ''

  return /\bname\s*:\s*['"`]([^'"`]+)['"`]/.exec(script)?.[1] ?? 'workflow'
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
  const status: AgentCard['status'] = isAnswered ? 'done' : 'failed'
  const cards = run.cards.map((c): AgentCard => (c.id === id ? { ...c, status, endedAt: now } : c))
  // Finished lines stay for the session, the newest FINISHED_KEEP of them.
  const finished = cards.filter(c => c.status !== 'running').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  const dropped = new Set(finished.slice(FINISHED_KEEP).map(c => c.id))

  return { ...run, cards: cards.filter(c => !dropped.has(c.id)) }
}

export function isRunning(run: AgentRun | null): boolean {
  return run !== null && run.cards.some(c => c.status === 'running')
}

/** The pane's header line: the team size when one is picked, then the non-zero counts. */
export function headerText(run: AgentRun | null, team: TeamPick): string {
  const cards = run?.cards ?? []
  const working = cards.filter(c => c.status === 'running').length
  const helpers = cards.filter(c => c.status === 'running' && (c.kind ?? 'helper') === 'helper').length
  const done = cards.filter(c => c.status === 'done').length
  const failed = cards.filter(c => c.status === 'failed').length
  const parts = team === 'default' ? [] : [`${team} agents`]
  const counts: [number, string][] = [
    [working, 'working'],
    [team === 'default' ? 0 : Math.max(0, team - helpers), 'idle'],
    [run?.queued.length ?? 0, 'queued'],
    [done, 'done'],
    [failed, 'failed'],
  ]
  for (const [n, label] of counts) {
    if (n > 0) parts.push(`${n} ${label}`)
  }

  return parts.join(' · ')
}

type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const QUIET = { plain: true, dimColor: true } as const
/** Task View's marks: ○ waiting, ● running in blue, ✓ done (dim, as the rest of a finished line); a red × failed. */
const CARD_MARKS = { queued: '○', running: '●', done: '✓', failed: '×' } as const

/** The run's lines in order: running ones (oldest first), then finished ones, the most recently finished first. */
export function orderedCards(run: AgentRun): AgentCard[] {
  const running = run.cards.filter(c => c.status === 'running').sort((a, b) => a.startedAt - b.startedAt)
  const finished = run.cards.filter(c => c.status !== 'running').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

  return [...running, ...finished]
}

/**
 * The dock pane: controls on top, a size warning, then the header and a card per helper; once the job is done and
 * Claude has replied, a line under the cards says how long the helpers took, until the next request.
 */
export function renderDock(
  el: El,
  dock: {
    team: TeamPick
    helpers: HelperMode
    showing: AgentShowing
    hideAfter: HideAfter
    requestAt: number | null
    run: AgentRun | null
    now: number
  },
  on: {
    setTeam(pick: TeamPick): void
    setHelpers(mode: HelperMode): void
    setShowing(showing: AgentShowing): void
    setHideAfter(minutes: HideAfter): void
  },
) {
  const { Box, Text, Button } = el
  const { team, helpers, showing, hideAfter, run, now } = dock
  const shown = run === null ? null : { ...run, cards: visibleCards(run.cards, { ...dock, now }) }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>Showing:</Text>
          {(['all', 'tool', 'current'] as const).map(pick => (
            renderPick(el, `showing-${pick}`, SHOWING_LABELS[pick], showing === pick, () => on.setShowing(pick))
          ))}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>Hide completed:</Text>
          {HIDE_AFTER.map(minutes => (
            renderPick(el, `hide-${minutes}`, hideAfterLabel(minutes), hideAfter === minutes, () => on.setHideAfter(minutes))
          ))}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>Set team size:</Text>
          {TEAM_PICKS.map(pick => (
            renderPick(el, `team-${pick}`, pick === 'default' ? 'Default' : String(pick), team === pick, () => on.setTeam(pick))
          ))}
        </Box>
        {/* Set model only applies with a team: on Default it shows, faint and unpickable. */}
        {team === 'default' ? (
          <Box flexDirection="row" columnGap={1}>
            <Text color={FAINT_TEXT}>Set model:</Text>
            {(['same', 'fast'] as const).map(mode => (
              <Text key={`helpers-${mode}`} color={FAINT_TEXT}>
                {HELPER_LABELS[mode]}
              </Text>
            ))}
          </Box>
        ) : (
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>Set model:</Text>
            {(['same', 'fast'] as const).map(mode =>
              renderPick(el, `helpers-${mode}`, HELPER_LABELS[mode], helpers === mode, () => on.setHelpers(mode)),
            )}
          </Box>
        )}
      </Box>
      {team !== 'default' && team > LARGE_TEAM && (
        <Text color="yellow">{`⚠ A team of ${team} uses your Claude usage much faster.`}</Text>
      )}
      {shown === null || (shown.cards.length === 0 && shown.queued.length === 0) ? (
        team !== 'default' && (
          <Text dimColor>
            {`Your next prompt can hand work to ${team} ${HELPER_LABELS[helpers]} helpers.`}
          </Text>
        )
      ) : (
        // Queued pieces on top, then the subagents running, then the finished ones, the latest first.
        <Box flexDirection="column">
          <Text dimColor>{headerText(shown, team)}</Text>
          {shown.queued.map(task => renderQueued(el, task))}
          {orderedCards(shown).map(card => renderCard(el, card, now))}
        </Box>
      )}
    </Box>
  )
}

/** Behind the picked choice: a Button takes no background, so a Box behind it carries one the white label reads on. */
const PICKED_BACKGROUND = '#2e2e2c'

/**
 * One choice of an option row, as the bar's own buttons (plain, compact): the one picked at full strength on a grey
 * ground, the rest dim. Pressing the picked one picks it again, changing nothing.
 */
function renderPick(el: El, key: string, label: string, isPicked: boolean, onPick: () => void) {
  const { Box, Button } = el

  return isPicked ? (
    <Box key={`picked-${key}`} backgroundColor={PICKED_BACKGROUND}>
      <Button key={key} label={label} plain dimColor={false} onPress={() => onPick()} />
    </Box>
  ) : (
    <Button key={key} label={label} plain dimColor onPress={() => onPick()} />
  )
}

/** A piece waiting for a free helper: dim, with nothing to time yet. */
function renderQueued(el: El, task: string) {
  const { Box, Text } = el

  return (
    <Box key={`queued-${task}`} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" flexShrink={1}>
        <Text color={FAINT_TEXT}>{`${CARD_MARKS.queued} `}</Text>
        <Text color={FAINT_TEXT} wrap="truncate-end">
          {task}
        </Text>
      </Box>
      <Text color={FAINT_TEXT}>queued</Text>
    </Box>
  )
}

/**
 * One subagent's row. Running: a blue ●, its name in the half-dim grey and what it is doing faint, then (a helper
 * reporting progress) its percent and bar, and its time so far. Finished: all faint (a failed one's × red), and its time
 * with how long ago it finished: `0:09 (3m ago)`.
 */
function renderCard(el: El, card: AgentCard, now: number) {
  const { Box, Text } = el
  const time = elapsed((card.endedAt ?? now) - card.startedAt)
  if (card.status !== 'running') {
    return (
      <Box key={`agent-${card.id}`} flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexShrink={1}>
          <Text color={card.status === 'failed' ? 'red' : FAINT_TEXT}>{`${CARD_MARKS[card.status]} `}</Text>
          <Text color={FAINT_TEXT} wrap="truncate-end">
            {card.task}
          </Text>
        </Box>
        <Text color={FAINT_TEXT}>{` ${time} (${ago(now - (card.endedAt ?? now))})`}</Text>
      </Box>
    )
  }
  const percent = card.percent ?? 0
  const bar = progressBar(percent)
  const isMeasured = (card.kind ?? 'helper') === 'helper' || card.percent !== undefined

  return (
    <Box key={`agent-${card.id}`} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" flexShrink={1}>
        <Text color={BLUE}>{`${CARD_MARKS.running} `}</Text>
        <Text color={DOING_TEXT} wrap="truncate-end">
          {card.task}
        </Text>
        {card.doing && (
          <Text color={FAINT_TEXT} wrap="truncate-end">
            {` · ${card.doing}`}
          </Text>
        )}
      </Box>
      <Box flexDirection="row" flexShrink={0}>
        {isMeasured ? (
          <Box flexDirection="row">
            <Text dimColor>{` ${String(percent).padStart(3)}% `}</Text>
            <Text color={BLUE}>{bar.filled}</Text>
            <Text dimColor>{bar.empty}</Text>
          </Box>
        ) : (
          <Text>{' '.repeat(6 + bar.filled.length + bar.empty.length)}</Text>
        )}
        <Text dimColor>{` ${time.padStart(5)}`}</Text>
      </Box>
    </Box>
  )
}
