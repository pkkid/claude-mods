import { describe, expect, test } from 'claude-code/testing'

import { PRUNER_HEIGHT, PRUNER_WIDTH, prunerAlt, prunerSvg } from '../src/pruner'
import {
  age,
  cleanText,
  combineChecks,
  deleteText,
  headerText,
  isCleanable,
  isDeletable,
  parseBranchRefs,
  parsePrs,
  parseRuns,
  parseShortstat,
  parseWorktreeList,
  prunerMode,
  removedText,
  rowText,
  sortWorktrees,
  toWorktree,
  worktreeNote,
} from '../src/worktrees'
import type { WorktreeFacts } from '../src/worktrees'
import type { Worktree } from '../types'

const LIST = `worktree /repo
HEAD aaa
branch refs/heads/main

worktree /repo/.claude/worktrees/feat
HEAD bbb
branch refs/heads/feat/x

worktree /repo/.claude/worktrees/old
HEAD ccc
detached
locked in use
prunable gitdir file points to non-existent location
`

function facts(over: Partial<WorktreeFacts> & { branch?: string | null; head?: string } = {}): WorktreeFacts {
  const { branch = 'feat/x', head = 'bbb', ...rest } = over
  return {
    entry: { path: '/repo/.claude/worktrees/feat', head, branch, isLocked: false, isMissing: false },
    isMain: false,
    isCurrent: false,
    changedFiles: 0,
    ahead: 0,
    added: 10,
    removed: 3,
    ...rest,
  }
}

const tree = (over: Partial<WorktreeFacts> & { branch?: string | null; head?: string } = {}): Worktree =>
  toWorktree(facts(over), new Map(), new Map())

describe('worktrees: reading git', () => {
  test('the porcelain list: branches, a detached HEAD, locked and missing folders', () => {
    const entries = parseWorktreeList(LIST)
    expect(entries.map(e => e.path)).toEqual(['/repo', '/repo/.claude/worktrees/feat', '/repo/.claude/worktrees/old'])
    expect(entries[1]).toEqual({ path: '/repo/.claude/worktrees/feat', head: 'bbb', branch: 'feat/x', isLocked: false, isMissing: false })
    expect(entries[2]).toMatchObject({ branch: null, isLocked: true, isMissing: true })
  })

  test('branch refs: the remote branch tracked, how far ahead, and none once the remote branch is gone', () => {
    const refs = parseBranchRefs(
      ['feat/x\torigin\trefs/heads/feat/x\t[ahead 2, behind 1]\t1760000000', 'gone\torigin\trefs/heads/gone\t[gone]\t1760000000', 'local\t\t\t\t'].join('\n'),
    )
    expect(refs.get('feat/x')).toEqual({ remote: { name: 'origin', branch: 'feat/x' }, ahead: 2, committedAt: 1760000000000 })
    expect(refs.get('gone')?.remote).toBeNull()
    expect(refs.get('local')).toEqual({ remote: null, ahead: 0, committedAt: null })
  })

  test('shortstat: insertions and deletions, either missing', () => {
    expect(parseShortstat(' 3 files changed, 12 insertions(+), 4 deletions(-)')).toEqual({ added: 12, removed: 4 })
    expect(parseShortstat(' 1 file changed, 1 insertion(+)')).toEqual({ added: 1, removed: 0 })
    expect(parseShortstat('')).toEqual({ added: 0, removed: 0 })
  })
})

describe('worktrees: GitHub', () => {
  test("a pull request's checks: any failure fails, else anything running runs", () => {
    const prs = parsePrs(
      JSON.stringify([
        { number: 4, url: 'u4', state: 'OPEN', headRefName: 'a', headRefOid: 'x', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }] },
        { number: 5, url: 'u5', state: 'MERGED', headRefName: 'b', headRefOid: 'y', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'FAILURE' }] },
        { number: 6, url: 'u6', state: 'MERGED', headRefName: 'c', headRefOid: 'z', statusCheckRollup: [] },
      ]),
    )
    expect(prs.get('a')?.[0]?.ci).toBe('running')
    expect(prs.get('b')?.[0]).toMatchObject({ number: 5, state: 'merged', ci: 'fail' })
    expect(prs.get('c')?.[0]?.ci).toBe('none')
    expect(parsePrs('not json').size).toBe(0)
  })

  test('workflow runs combine per commit', () => {
    const runs = parseRuns(
      JSON.stringify([
        { headSha: 'x', status: 'completed', conclusion: 'success' },
        { headSha: 'x', status: 'completed', conclusion: 'skipped' },
        { headSha: 'y', status: 'completed', conclusion: 'success' },
        { headSha: 'y', status: 'queued', conclusion: '' },
      ]),
    )
    expect(runs.get('x')).toBe('pass')
    expect(runs.get('y')).toBe('running')
    expect(combineChecks([])).toBe('none')
  })

  test("a squash-merged branch counts as merged only while it is still at the pull request's commit", () => {
    const prs = parsePrs(JSON.stringify([{ number: 9, url: 'u', state: 'MERGED', headRefName: 'feat/x', headRefOid: 'bbb', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] }]))
    const merged = toWorktree(facts({ ahead: 3 }), prs, new Map())
    expect(merged).toMatchObject({ isMerged: true, ci: 'pass', pr: { number: 9, state: 'merged' } })
    const moved = toWorktree(facts({ ahead: 4, head: 'ddd' }), prs, new Map([['ddd', 'running' as const]]))
    expect(moved).toMatchObject({ isMerged: false, ci: 'running' })
  })
})

describe('worktrees: what Clean removes', () => {
  test('merged and clean, on a branch, not in use: cleaned; anything else kept', () => {
    expect(isCleanable(tree())).toBe(true)
    expect(isCleanable(tree({ changedFiles: 1 }))).toBe(false)
    expect(isCleanable(tree({ ahead: 2 }))).toBe(false)
    expect(isCleanable(tree({ isCurrent: true }))).toBe(false)
    expect(isCleanable(tree({ isMain: true }))).toBe(false)
    expect(isCleanable(tree({ branch: null }))).toBe(true)
    expect(isCleanable(tree({ branch: null, ahead: 1 }))).toBe(false)
    const locked = { ...tree(), isLocked: true }
    expect(isCleanable(locked)).toBe(false)
    expect(isDeletable(locked)).toBe(false)
    expect(isDeletable(tree({ isCurrent: true }))).toBe(false)
    expect(isDeletable(tree({ changedFiles: 4, ahead: 2 }))).toBe(true)
  })

  test('the header and Clean line count what is cleaned and what stays', () => {
    const rows = [tree({ isMain: true, branch: 'main' }), tree(), tree({ changedFiles: 2 }), tree({ ahead: 1 })]
    expect(headerText(rows)).toBe('3 worktrees · 1 to prune · 1 with changes · 1 unpushed')
    expect(cleanText(rows, 'origin/main')).toBe('Prune removes 1 merged worktree with their local and remote branches. 2 worktrees with changes, unmerged commits or in use stay.')
    expect(cleanText([rows[0]!, rows[2]!], 'origin/main')).toBe('Nothing to prune: each worktree has changes, commits not on main, or is in use.')
    expect(cleanText([rows[0]!], 'origin/main')).toBe('No worktrees besides the main checkout.')
  })

  test('deleting one row says what it would lose, and keeps an unmerged remote branch', () => {
    const ref = { remote: { name: 'origin', branch: 'feat/x' }, ahead: 2, committedAt: null }
    expect(deleteText(tree({ changedFiles: 3, ahead: 2, ref }))).toEqual({
      question: 'Delete feat/x and its branch?',
      warning: 'This loses 3 uncommitted files and 2 unpushed commits. origin/feat/x is kept.',
    })
    expect(deleteText(tree({ ref: { ...ref, ahead: 0 } })).warning).toBe('origin/feat/x is deleted too.')
  })

  test('what removing came to', () => {
    expect(
      removedText([
        { name: 'a', isRemoved: true, isBranchDeleted: true, isRemoteDeleted: true },
        { name: 'b', isRemoved: true, isBranchDeleted: true, isRemoteDeleted: false },
        { name: 'c', isRemoved: false, isBranchDeleted: false, isRemoteDeleted: false, error: 'contains modified files' },
      ]),
    ).toEqual({ text: "Removed 2 worktrees with 2 branches and 1 remote branch. Couldn't remove c: contains modified files.", isError: true })
  })
})

describe('worktrees: rows', () => {
  test('the main checkout first, then this session, then the latest commit', () => {
    const at = (committedAt: number, over: Partial<WorktreeFacts> = {}) => ({ ...tree(over), committedAt, path: String(committedAt) })
    const rows = sortWorktrees([at(1), at(3), at(2, { isCurrent: true }), at(0, { isMain: true })])
    expect(rows.map(w => w.path)).toEqual(['0', '2', '3', '1'])
  })

  test("a detached worktree, as the desktop app makes them: named by its folder, its pull request found by commit", () => {
    const prs = parsePrs(JSON.stringify([{ number: 173, url: 'u', state: 'MERGED', headRefName: 'feat/owl', headRefOid: 'bbb', statusCheckRollup: [] }]))
    const w = toWorktree(facts({ branch: null, ahead: 2 }), prs, new Map())
    expect(w).toMatchObject({ isMerged: true, pr: { number: 173 } })
    expect(worktreeNote(w)).toBe('merged · PR #173 · detached')
    expect(isCleanable(w)).toBe(true)
    expect(deleteText(w).question).toBe('Delete feat?')
  })

  test('the note after a name', () => {
    expect(worktreeNote(tree({ isMain: true, branch: 'main' }))).toBe('main checkout')
    expect(worktreeNote(tree({ isMain: true, isCurrent: true, branch: 'main', changedFiles: 2 }))).toBe('2 changed files · main checkout · this session')
    expect(worktreeNote(tree({ changedFiles: 1, ahead: 2 }))).toBe('1 changed file · 2 unpushed commits')
    expect(worktreeNote(tree())).toBe('merged')
  })

  test("a merged worktree's commits ahead are not called unpushed", () => {
    expect(worktreeNote({ ...tree({ ahead: 2 }), isMerged: true })).toBe('merged')
  })

  test("a long name keeps the note's first parts whole, or the first cut to the room", () => {
    const prs = parsePrs(JSON.stringify([{ number: 171, url: 'u', state: 'MERGED', headRefName: 'f', headRefOid: 'bbb', statusCheckRollup: [] }]))
    const at = (path: string) => ({ ...toWorktree(facts({ branch: null }), prs, new Map()), path })
    expect(rowText(at('/r/history-view-challenge-finisher-4cc506'))).toEqual({ name: 'history-view-challenge-finisher-4cc506', note: 'merged' })
    expect(rowText(at('/r/challenge-view-display-fields-2bcfa1'))).toEqual({ name: 'challenge-view-display-fields-2bcfa1', note: 'merged' })
    expect(rowText(at('/r/owl'))).toEqual({ name: 'owl', note: 'merged · PR #171 · detached' })
    expect(rowText({ ...tree({ changedFiles: 12 }), branch: 'x'.repeat(40) }).note).toBe('12 cha…')
    expect(rowText({ ...tree(), branch: 'x'.repeat(60) })).toEqual({ name: `${'x'.repeat(49)}…`, note: '' })
  })

  test('ages in their largest unit', () => {
    expect(age(30_000)).toBe('now')
    expect(age(5 * 60_000)).toBe('5m')
    expect(age(3 * 3_600_000)).toBe('3h')
    expect(age(12 * 86_400_000)).toBe('12d')
  })
})

describe('pruner', () => {
  test('pruning while there are worktrees, napping with none, sweeping while removing', () => {
    const ready = (rows: Worktree[]) => ({ status: 'ready' as const, base: 'origin/main', worktrees: rows })
    expect(prunerMode(ready([tree({ isMain: true }), tree()]), null)).toBe('pruning')
    expect(prunerMode(ready([tree({ isMain: true })]), null)).toBe('napping')
    expect(prunerMode(ready([tree({ isMain: true })]), { step: 'busy', target: { kind: 'clean' } })).toBe('sweeping')
    expect(prunerMode(null, null)).toBe('pruning')
  })

  test('napping, Clawd and the tree are all grey', () => {
    const napping = prunerSvg('napping')
    for (const color of ['#D77757', '#7FB685', '#8B5A3C']) {
      expect(napping).not.toContain(color)
      expect(prunerSvg('pruning')).toContain(color)
    }
    expect(prunerAlt('napping')).toBe('Clawd asleep under a tree')
    expect(prunerSvg('sweeping')).toContain(`width="${PRUNER_WIDTH}" height="${PRUNER_HEIGHT}"`)
    expect(prunerSvg('sweeping')).toBe(prunerSvg('sweeping'))
  })
})
