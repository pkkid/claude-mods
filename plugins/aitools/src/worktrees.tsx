import type { Elements, RenderChildren } from 'claude-code'

import type { CiState, Worktree, WorktreeAction, WorktreeList, WorktreePr, WorktreeTarget } from '../types'
import { BLUE, DOING_TEXT, FAINT_TEXT, GREEN } from './checklist'
import { PRUNER_HEIGHT, PRUNER_WIDTH, prunerAlt, prunerSvg } from './pruner'
import type { PrunerMode } from './pruner'

export const WORKTREES_PANE = 'worktrees'
/** How often the open pane reads git again, and how many of those reads go by between GitHub's (PRs and CI). */
export const REFRESH_MS = 10_000
export const GITHUB_EVERY = 6
/** How long after a tool that can change files the open pane reads git again: a burst of edits reads once. */
export const AFTER_TOOL_MS = 1500
/** How long the sweeping Clawd shows at least, so a quick clean is still seen. */
export const SWEEP_MS = 2400
/** Tools that can change a worktree or make one (a subagent can run in its own): the open pane reads git again after one. */
export const CHANGING_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Agent', 'EnterWorktree', 'ExitWorktree'])

/** One entry of `git worktree list --porcelain`. */
export type WorktreeEntry = { path: string; head: string; branch: string | null; isLocked: boolean; isMissing: boolean }

/** The entries of `git worktree list --porcelain`, the main working tree first; bare entries left out. */
export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  for (const block of stdout.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(Boolean)
    const path = lines.find(l => l.startsWith('worktree '))?.slice('worktree '.length)
    if (path === undefined || lines.includes('bare')) {
      continue
    }
    const branch = lines.find(l => l.startsWith('branch '))?.slice('branch '.length)
    entries.push({
      path,
      head: lines.find(l => l.startsWith('HEAD '))?.slice('HEAD '.length) ?? '',
      branch: branch === undefined ? null : branch.replace(/^refs\/heads\//, ''),
      isLocked: lines.some(l => l === 'locked' || l.startsWith('locked ')),
      isMissing: lines.some(l => l === 'prunable' || l.startsWith('prunable ')),
    })
  }

  return entries
}

/** The `git for-each-ref` format `parseBranchRefs` reads: one branch a line, tab separated. */
export const BRANCH_FORMAT = '%(refname:short)%09%(upstream:remotename)%09%(upstream:remoteref)%09%(upstream:track)%09%(committerdate:unix)'

/** A local branch: the remote branch it tracks (null when none, or gone), how far ahead of it, its last commit. */
export type BranchRef = { remote: { name: string; branch: string } | null; ahead: number; committedAt: number | null }

export function parseBranchRefs(stdout: string): Map<string, BranchRef> {
  const refs = new Map<string, BranchRef>()
  for (const line of stdout.split('\n')) {
    const [name, remote = '', remoteRef = '', track = '', date = ''] = line.split('\t')
    if (!name) {
      continue
    }
    const isTracked = remote !== '' && remoteRef !== '' && !track.includes('gone')
    const seconds = Number(date)
    refs.set(name, {
      remote: isTracked ? { name: remote, branch: remoteRef.replace(/^refs\/heads\//, '') } : null,
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
      committedAt: date !== '' && Number.isFinite(seconds) ? seconds * 1000 : null,
    })
  }

  return refs
}

/** Lines added and removed from `git diff --shortstat`. */
export function parseShortstat(stdout: string): { added: number; removed: number } {
  return {
    added: Number(/(\d+) insertion/.exec(stdout)?.[1] ?? 0),
    removed: Number(/(\d+) deletion/.exec(stdout)?.[1] ?? 0),
  }
}

/** Entries of `git status --porcelain`: changed, staged and untracked files. */
export function countChanged(stdout: string): number {
  return stdout.split('\n').filter(l => l.trim() !== '').length
}

type Check = { __typename?: string; status?: string; conclusion?: string; state?: string }

/** One check of a pull request's status rollup: a check run, or a commit status. */
function checkState(c: Check): CiState {
  if (c.state !== undefined && c.status === undefined) {
    return c.state === 'SUCCESS' ? 'pass' : c.state === 'PENDING' || c.state === 'EXPECTED' ? 'running' : 'fail'
  }
  if (c.status !== undefined && c.status.toUpperCase() !== 'COMPLETED') {
    return 'running'
  }
  const conclusion = (c.conclusion ?? '').toUpperCase()

  return conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED' ? 'pass' : 'fail'
}

/** Several checks as one: any failed fails, else any running runs, else passed; none is none. */
export function combineChecks(states: readonly CiState[]): CiState {
  return states.includes('fail') ? 'fail' : states.includes('running') ? 'running' : states.includes('pass') ? 'pass' : 'none'
}

/** A pull request as `gh pr list --json` gives it, with its checks combined. */
export type PrFacts = WorktreePr & { branch: string; headOid: string; ci: CiState }

/** `gh pr list --json number,url,state,headRefName,headRefOid,statusCheckRollup`, by branch, newest first. */
export function parsePrs(json: string): Map<string, PrFacts[]> {
  const prs = new Map<string, PrFacts[]>()
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return prs
  }
  if (!Array.isArray(rows)) {
    return prs
  }
  for (const row of rows as Record<string, unknown>[]) {
    const branch = typeof row.headRefName === 'string' ? row.headRefName : ''
    const state = String(row.state ?? '').toLowerCase()
    if (!branch || typeof row.number !== 'number' || (state !== 'open' && state !== 'merged' && state !== 'closed')) {
      continue
    }
    const checks = Array.isArray(row.statusCheckRollup) ? (row.statusCheckRollup as Check[]) : []
    const pr: PrFacts = {
      number: row.number,
      url: typeof row.url === 'string' ? row.url : '',
      state,
      branch,
      headOid: typeof row.headRefOid === 'string' ? row.headRefOid : '',
      ci: combineChecks(checks.map(checkState)),
    }
    prs.set(branch, [...(prs.get(branch) ?? []), pr].sort((a, b) => b.number - a.number))
  }

  return prs
}

/** `gh run list --json headSha,status,conclusion`: each commit's workflow runs combined. */
export function parseRuns(json: string): Map<string, CiState> {
  const bySha = new Map<string, CiState[]>()
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return new Map()
  }
  if (!Array.isArray(rows)) {
    return new Map()
  }
  for (const row of rows as Record<string, unknown>[]) {
    if (typeof row.headSha !== 'string') {
      continue
    }
    const state = checkState({ status: String(row.status ?? ''), conclusion: String(row.conclusion ?? '') })
    bySha.set(row.headSha, [...(bySha.get(row.headSha) ?? []), state])
  }

  return new Map([...bySha].map(([sha, states]) => [sha, combineChecks(states)]))
}

/** A branch's pull request: the one at its commit, else the open one, else the newest. */
export function pickPr(prs: readonly PrFacts[] | undefined, head: string): PrFacts | null {
  if (!prs || prs.length === 0) {
    return null
  }

  return prs.find(p => p.headOid === head) ?? prs.find(p => p.state === 'open') ?? prs[0]!
}

/** What git says of one worktree, before GitHub's word. */
export type WorktreeFacts = {
  entry: WorktreeEntry
  isMain: boolean
  isCurrent: boolean
  ref?: BranchRef
  changedFiles: number
  /** Commits on it that are not on the base branch. */
  ahead: number
  /** Its last commit (epoch ms), read in its folder: a detached worktree has no branch to read it from. */
  committedAt?: number | null
  added: number
  removed: number
}

/**
 * A worktree's row from git's facts and GitHub's: merged when it has no commit the base branch lacks, or its pull
 * request merged at its commit (a squash merge); CI from its pull request's checks at its commit, else the runs at it.
 */
export function toWorktree(f: WorktreeFacts, prs: Map<string, PrFacts[]>, runs: Map<string, CiState>): Worktree {
  const { entry } = f
  // A detached worktree (the desktop app makes them) has no branch to look up: its pull request is the one at its commit.
  const prFacts =
    entry.branch === null ? ([...prs.values()].flat().find(p => p.headOid === entry.head) ?? null) : pickPr(prs.get(entry.branch), entry.head)
  const isMergedPr = prFacts !== null && prFacts.state === 'merged' && prFacts.headOid === entry.head
  const remote = f.ref?.remote ?? null
  const ci = prFacts !== null && prFacts.headOid === entry.head && prFacts.ci !== 'none' ? prFacts.ci : (runs.get(entry.head) ?? 'none')

  return {
    path: entry.path,
    branch: entry.branch,
    head: entry.head,
    isMain: f.isMain,
    isCurrent: f.isCurrent,
    isLocked: entry.isLocked,
    isMissing: entry.isMissing,
    added: f.added,
    removed: f.removed,
    changedFiles: f.changedFiles,
    ahead: f.ahead,
    unpushed: remote === null ? f.ahead : (f.ref?.ahead ?? 0),
    isMerged: !f.isMain && (f.ahead === 0 || isMergedPr),
    remote,
    committedAt: f.committedAt ?? f.ref?.committedAt ?? null,
    pr: prFacts === null ? null : { number: prFacts.number, url: prFacts.url, state: prFacts.state },
    ci,
  }
}

/** Rows in order: the main checkout always first, then the one this session is in, then the rest, the latest commit first. */
export function sortWorktrees(list: readonly Worktree[]): Worktree[] {
  const rank = (w: Worktree) => (w.isMain ? 0 : w.isCurrent ? 1 : 2)

  return [...list].sort((a, b) => rank(a) - rank(b) || (b.committedAt ?? 0) - (a.committedAt ?? 0))
}

/**
 * Whether Prune removes it: not the main checkout or the one this session is in, not locked, nothing uncommitted and
 * nothing unmerged. A detached worktree counts too: it has only its folder to remove.
 */
export function isCleanable(w: Worktree): boolean {
  return !w.isMain && !w.isCurrent && !w.isLocked && w.changedFiles === 0 && w.isMerged
}

/** Whether the row offers its own delete: never on the main checkout or the one this session is in. */
export function isDeletable(w: Worktree): boolean {
  return !w.isMain && !w.isCurrent && !w.isLocked
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a worktree is called: its branch, or its folder's name when it has none. */
export function worktreeName(w: Pick<Worktree, 'branch' | 'path'>): string {
  return w.branch ?? w.path.split('/').filter(Boolean).at(-1) ?? w.path
}

/**
 * The faint words after a row's name, most telling first, so a cut row still says them: what it holds that Prune
 * would keep (or that it is merged), then its pull request, then what it is.
 */
export function noteParts(w: Worktree): string[] {
  const parts: string[] = []
  if (w.changedFiles > 0) parts.push(plural(w.changedFiles, 'changed file'))
  // A merged worktree's commits are on the base already (a squash merge leaves them ahead in name only).
  if (w.unpushed > 0 && !w.isMerged) {
    parts.push(plural(w.unpushed, 'unpushed commit'))
  } else if (!w.isMain && !w.isMerged && w.ahead > 0) {
    parts.push(plural(w.ahead, 'unmerged commit'))
  }
  if (w.isMerged) parts.push('merged')
  if (w.isMissing) parts.push('folder missing')
  if (w.isLocked) parts.push('locked')
  if (w.pr) parts.push(`PR #${w.pr.number}${w.pr.state === 'closed' ? ' closed' : ''}`)
  if (w.isMain) parts.push('main checkout')
  if (w.isCurrent) parts.push('this session')
  if (w.branch === null) parts.push('detached')

  return parts
}

export function worktreeNote(w: Worktree): string {
  return noteParts(w).join(' · ')
}

/** The fewest characters of room worth cutting a note's first part into; with less the note is left off. */
const NOTE_MIN = 4

/**
 * A row's name and note within `max` characters together, ` · ` between: the name first (cut with `…` past `max`),
 * then the note's parts that fit whole in what is left; when not even the first does, it is cut to the room.
 */
export function rowText(w: Worktree, max = ROW_TEXT_MAX): { name: string; note: string } {
  const clip = (text: string, n: number) => {
    const chars = Array.from(text)
    return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : text
  }
  const name = clip(worktreeName(w), max)
  const room = max - Array.from(name).length - 3
  const parts = noteParts(w)
  const fit: string[] = []
  for (const part of parts) {
    if (Array.from([...fit, part].join(' · ')).length > room) break
    fit.push(part)
  }
  const note = fit.length > 0 ? fit.join(' · ') : parts.length > 0 && room >= NOTE_MIN ? clip(parts[0]!, room) : ''

  return { name, note }
}

/** The row's mark: ● blue where this session is, ● yellow with changes, ↑ yellow with unpushed commits, ○ else. */
export function worktreeMark(w: Worktree): { text: string; color: string } {
  if (w.isCurrent) return { text: '●', color: BLUE }
  if (w.changedFiles > 0) return { text: '●', color: 'yellow' }
  if (w.unpushed > 0 && !w.isMerged) return { text: '↑', color: 'yellow' }

  return { text: '○', color: FAINT_TEXT }
}

/** CI's mark: ✓ passed, × failed, ● running, – none. */
export const CI_MARKS: Record<CiState, { text: string; color: string }> = {
  pass: { text: '✓', color: GREEN },
  fail: { text: '×', color: 'red' },
  running: { text: '●', color: 'yellow' },
  none: { text: '–', color: FAINT_TEXT },
}

/** The base branch as a person names it: `origin/main` is main. */
export function baseName(base: string): string {
  return base.replace(/^[^/]+\//, '')
}

/** The header line: how many worktrees besides the main checkout, then the non-zero counts. */
export function headerText(list: readonly Worktree[]): string {
  const others = list.filter(w => !w.isMain)
  const parts = [plural(others.length, 'worktree')]
  const counts: [number, string][] = [
    [others.filter(isCleanable).length, 'to prune'],
    [others.filter(w => w.changedFiles > 0).length, 'with changes'],
    [others.filter(w => w.unpushed > 0 && !w.isMerged).length, 'unpushed'],
  ]
  for (const [n, label] of counts) {
    if (n > 0) parts.push(`${n} ${label}`)
  }

  return parts.join(' · ')
}

/** What Prune would do, said before it is pressed. */
export function cleanText(list: readonly Worktree[], base: string): string {
  const others = list.filter(w => !w.isMain)
  if (others.length === 0) {
    return 'No worktrees besides the main checkout.'
  }
  const n = others.filter(isCleanable).length
  const kept = others.length - n
  if (n === 0) {
    return `Nothing to prune: each worktree has changes, commits not on ${baseName(base)}, or is in use.`
  }
  const keeps = kept > 0 ? ` ${plural(kept, 'worktree')} with changes, unmerged commits or in use stay.` : ''

  return `Prune removes ${plural(n, 'merged worktree')} with their local and remote branches.${keeps}`
}

/** What deleting one row asks first, and what it would lose. */
export function deleteText(w: Worktree): { question: string; warning: string } {
  const lost: string[] = []
  if (w.changedFiles > 0) lost.push(plural(w.changedFiles, 'uncommitted file'))
  if (!w.isMerged && w.ahead > 0) lost.push(plural(w.unpushed > 0 ? w.unpushed : w.ahead, w.unpushed > 0 ? 'unpushed commit' : 'unmerged commit'))
  const remote = w.remote === null ? '' : `${w.remote.name}/${w.remote.branch}`
  const parts: string[] = []
  if (lost.length > 0) parts.push(`This loses ${lost.join(' and ')}.`)
  if (remote) parts.push(w.isMerged ? `${remote} is deleted too.` : `${remote} is kept.`)

  return { question: `Delete ${worktreeName(w)}${w.branch ? ' and its branch' : ''}?`, warning: parts.join(' ') }
}

/** Clawd's pose: sweeping while worktrees are removed, napping with none besides the main checkout, else pruning. */
export function prunerMode(list: WorktreeList | null, action: WorktreeAction): PrunerMode {
  if (action?.step === 'busy') {
    return 'sweeping'
  }

  return list?.status === 'ready' && list.worktrees.every(w => w.isMain) ? 'napping' : 'pruning'
}

/** How long since, in its largest unit, compact: `5m`, `3h`, `12d`; `now` under a minute. */
export function age(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)

  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 24 * 60 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / (24 * 60))}d`
}

const sameTarget = (a: WorktreeTarget, b: WorktreeTarget) =>
  a.kind === b.kind && (a.kind === 'clean' || (b.kind === 'delete' && a.path === b.path))

/** `Svg` only where the surface draws it (the desktop): Clawd shows there alone. */
type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Svg?: Elements['desktop']['Svg'] }

/**
 * The Worktrees pane: the header, what Prune would do (or what it did), a blank line and Prune worktrees (or its
 * question), then a row per worktree. Where SVG is drawn, Clawd stands left of the controls.
 */
export function renderWorktrees(
  el: El,
  view: { list: WorktreeList | null; action: WorktreeAction; now: number },
  on: { ask(target: WorktreeTarget): void; confirm(): void; cancel(): void },
) {
  const { Box, Text, Svg } = el
  const { list, action } = view
  const mode = prunerMode(list, action)
  const ready = list?.status === 'ready' ? list : null
  const rows = ready ? sortWorktrees(ready.worktrees) : []

  let lines: RenderChildren[]
  if (list === null || list.status === 'loading') {
    lines = [<Text key="loading" dimColor>Reading worktrees…</Text>]
  } else if (list.status === 'error') {
    lines = [<Text key="error" dimColor>{list.text}</Text>]
  } else {
    lines = [
      <Text key="header" dimColor>{headerText(rows)}</Text>,
      action?.step === 'done' ? (
        <Text key="note" color={action.isError ? 'red' : FAINT_TEXT}>{action.text}</Text>
      ) : (
        <Text key="note" color={FAINT_TEXT}>{cleanText(rows, list.base)}</Text>
      ),
      renderClean(el, rows, action, on),
    ]
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {Svg && (
          <Box key="pruner" flexShrink={0} marginRight={2}>
            <Svg source={prunerSvg(mode)} alt={prunerAlt(mode)} width={PRUNER_WIDTH} height={PRUNER_HEIGHT} />
          </Box>
        )}
        <Box flexDirection="column" flexShrink={1}>
          {lines}
        </Box>
      </Box>
      {rows.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {rows.map(w => renderRow(el, w, view, on))}
        </Box>
      )}
    </Box>
  )
}

/** Prune worktrees, its question once pressed, or what it is doing, a blank line above; faint and unpressable with nothing to prune. */
function renderClean(el: El, rows: readonly Worktree[], action: WorktreeAction, on: { ask(target: WorktreeTarget): void; confirm(): void; cancel(): void }) {
  const { Box, Text, Button } = el
  const n = rows.filter(isCleanable).length
  if (action?.step === 'busy') {
    return (
      <Box key="clean" marginTop={1}>
        <Text dimColor>{action.target.kind === 'clean' ? 'Pruning worktrees…' : 'Deleting…'}</Text>
      </Box>
    )
  }
  if (action?.step === 'ask' && action.target.kind === 'clean') {
    return (
      <Box key="clean" flexDirection="row" columnGap={1} marginTop={1}>
        <Text>{`Remove ${plural(n, 'worktree')} and their branches?`}</Text>
        <Button key="clean-yes" label="Yes" plain dimColor={false} onPress={() => on.confirm()} />
        <Button key="clean-no" label="No" plain dimColor onPress={() => on.cancel()} />
      </Box>
    )
  }

  return (
    <Box key="clean" flexDirection="row" marginTop={1}>
      {n === 0 ? (
        <Text color={FAINT_TEXT}>Prune worktrees</Text>
      ) : (
        <Button key="clean" label="Prune worktrees" plain dimColor={false} onPress={() => on.ask({ kind: 'clean' })} />
      )}
    </Box>
  )
}

/**
 * The right-hand columns' widths in cells: age, lines added and removed, CI, delete. Each sits in a box of its own
 * width, so the columns line up on every row whatever is in them: a desktop's native × button is wider than a cell,
 * and rows without one keep its room empty. Added and removed share one column, two cells apart, lined up on the right.
 */
export const COLUMNS = { age: 5, changes: 15, ci: 3, delete: 3 } as const
/** The most characters a row's name and note take together, ` · ` included; the name has the room first. */
export const ROW_TEXT_MAX = 50

/**
 * One worktree's row: its mark, name and faint note on the left; how long since its last commit, lines added and
 * removed, CI and × on the right, in fixed columns. Pressing × asks first, on a line beneath the row, with what
 * deleting it would lose; pressing it again takes the question back.
 */
function renderRow(
  el: El,
  w: Worktree,
  view: { action: WorktreeAction; now: number },
  on: { ask(target: WorktreeTarget): void; confirm(): void; cancel(): void },
) {
  const { Box, Text, Button } = el
  const target: WorktreeTarget = { kind: 'delete', path: w.path }
  const isAsking = view.action?.step === 'ask' && sameTarget(view.action.target, target)
  const isBusy = view.action?.step === 'busy'
  const mark = worktreeMark(w)
  const ci = CI_MARKS[w.ci]
  const line = rowText(w)
  const nameColor = isCleanable(w) ? FAINT_TEXT : DOING_TEXT
  const ago = w.committedAt === null ? '' : age(view.now - w.committedAt)
  const ask = isAsking ? deleteText(w) : null
  const cell = (key: string, width: number, child: RenderChildren, justify: 'flex-end' | 'center' = 'flex-end') => (
    <Box key={key} width={width} flexShrink={0} flexDirection="row" justifyContent={justify}>
      {child}
    </Box>
  )

  return (
    <Box key={`worktree-${w.path}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexShrink={1}>
          <Text color={mark.color}>{`${mark.text} `}</Text>
          <Text color={nameColor} wrap="truncate-end">
            {line.name}
          </Text>
          {line.note && (
            <Text color={FAINT_TEXT} wrap="truncate-end">
              {` · ${line.note}`}
            </Text>
          )}
        </Box>
        <Box flexDirection="row" flexShrink={0}>
          {cell('age', COLUMNS.age, <Text color={FAINT_TEXT}>{ago}</Text>)}
          {cell(
            'changes',
            COLUMNS.changes,
            <Box flexDirection="row" columnGap={2}>
              <Text color={GREEN}>{`+${w.added}`}</Text>
              <Text color="red">{`−${w.removed}`}</Text>
            </Box>,
          )}
          {cell('ci', COLUMNS.ci, <Text color={ci.color}>{ci.text}</Text>, 'center')}
          {cell(
            'delete',
            COLUMNS.delete,
            isDeletable(w) && !isBusy ? (
              <Button key={`delete-${w.path}`} label="×" plain dimColor={!isAsking} onPress={() => (isAsking ? on.cancel() : on.ask(target))} />
            ) : null,
            'center',
          )}
        </Box>
      </Box>
      {ask && (
        <Box flexDirection="column" alignItems="flex-end">
          <Box flexDirection="row" columnGap={1}>
            <Text color="yellow">{ask.question}</Text>
            <Button key={`delete-yes-${w.path}`} label="Yes" plain dimColor={false} onPress={() => on.confirm()} />
            <Button key={`delete-no-${w.path}`} label="No" plain dimColor onPress={() => on.cancel()} />
          </Box>
          {ask.warning && <Text color={FAINT_TEXT}>{ask.warning}</Text>}
        </Box>
      )}
    </Box>
  )
}

/** What removing one worktree came to: its folder, its branch, its remote branch, or why it stopped. */
export type Removal = { name: string; isRemoved: boolean; isBranchDeleted: boolean; isRemoteDeleted: boolean; error?: string }

/** The line the pane shows once worktrees are removed: what went, then what could not be removed and why. */
export function removedText(results: readonly Removal[]): { text: string; isError: boolean } {
  const done = results.filter(r => r.isRemoved)
  const failed = results.filter(r => !r.isRemoved)
  const parts: string[] = []
  if (done.length > 0) {
    const branches = done.filter(r => r.isBranchDeleted).length
    const remotes = done.filter(r => r.isRemoteDeleted).length
    const also = [branches > 0 ? plural(branches, 'branch', 'branches') : '', remotes > 0 ? plural(remotes, 'remote branch', 'remote branches') : '']
      .filter(Boolean)
      .join(' and ')
    parts.push(`Removed ${plural(done.length, 'worktree')}${also ? ` with ${also}` : ''}.`)
  }
  for (const r of failed) {
    parts.push(`Couldn't remove ${r.name}: ${r.error ?? 'git refused'}.`)
  }

  return { text: parts.join(' ') || 'Nothing to remove.', isError: failed.length > 0 }
}

/** The first line a failed command wrote, for the pane: git's `fatal: ` or `error: ` left off. */
export function firstLine(stderr: string): string {
  const line = stderr.split('\n').find(l => l.trim() !== '') ?? ''

  return line.replace(/^(fatal|error): /, '').trim().replace(/\.$/, '')
}
