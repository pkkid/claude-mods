import { describe, expect, test } from 'claude-code/testing'

import {
  addCard,
  dockNote,
  FINISHED_KEEP,
  finishCard,
  headerText,
  isRunning,
  activityText,
  hideAfterLabel,
  visibleCards,
  isTeamPick,
  isTeamSize,
  newRun,
  noteActivity,
  orderedCards,
  queuePiece,
  reportProgress,
  workflowName,
} from '../src/agentdock'
import { elapsed } from '../src/format'

describe('agent runs', () => {
  test('a started helper gets a running card and leaves the queue', () => {
    const run = addCard(queuePiece(queuePiece(newRun(0), 'Draft'), 'Draft'), 'a1', 'Draft', 5)
    expect(run.queued).toEqual([])
    expect(run.cards).toEqual([{ id: 'a1', task: 'Draft', kind: 'helper', status: 'running', startedAt: 5 }])
    expect(isRunning(run)).toBe(true)
  })

  test('progress is rounded and held to 0 to 100; an empty doing keeps the last one', () => {
    let run = addCard(newRun(0), 'a1', 'Draft', 0)
    run = reportProgress(run, 'a1', 'Reading notes', 42.4)
    run = reportProgress(run, 'a1', '  ', 140)
    expect(run.cards[0]).toMatchObject({ doing: 'Reading notes', percent: 100 })
  })

  test('a finished helper is done when it answered, failed otherwise', () => {
    let run = addCard(addCard(newRun(0), 'a1', 'Draft', 0), 'a2', 'Check', 0)
    run = finishCard(run, 'a1', true, 9)
    run = finishCard(run, 'a2', false, 9)
    expect(run.cards.map(c => [c.status, c.endedAt])).toEqual([
      ['done', 9],
      ['failed', 9],
    ])
    expect(isRunning(run)).toBe(false)
  })
})

describe('dock text', () => {
  test('team sizes are the five offered', () => {
    expect([3, 5, 10, 20, 30].every(isTeamSize)).toBe(true)
    expect(isTeamSize(1)).toBe(false)
    expect(isTeamSize(4)).toBe(false)
    expect(isTeamSize('5')).toBe(false)
  })

  test('a team pick is Default or one of the sizes', () => {
    expect(isTeamPick('default')).toBe(true)
    expect(isTeamPick(5)).toBe(true)
    expect(isTeamPick('Default')).toBe(false)
    expect(isTeamPick(undefined)).toBe(false)
  })

  test('the note names the team size', () => {
    expect(dockNote(5)).toContain('up to 5 helper agents at once')
    expect(dockNote(3)).toContain('a team of 3 helper agents for')
  })

  test('the header shows the team, then only the counts that are not zero', () => {
    expect(headerText(null, 5)).toBe('5 agents · 5 idle')
    let run = queuePiece(addCard(addCard(newRun(0), 'a1', 'A', 0), 'a2', 'B', 0), 'C')
    run = finishCard(run, 'a2', true, 1)
    expect(headerText(run, 3)).toBe('3 agents · 1 working · 2 idle · 1 queued · 1 done')
  })

  test('elapsed reads as minutes and seconds, hours once past one', () => {
    expect(elapsed(65_000)).toBe('1:05')
    expect(elapsed(3_725_000)).toBe('1:02:05')
    expect(elapsed(-5)).toBe('0:00')
  })
})

describe('every subagent', () => {
  test('a tool call reads as a few words on what the subagent is doing', () => {
    expect(activityText('Read', { file_path: '/repo/src/bar.tsx' })).toBe('Reading bar.tsx')
    expect(activityText('Edit', { file_path: '/repo/README.md' })).toBe('Editing README.md')
    expect(activityText('Bash', { command: 'npm   test' })).toBe('Running npm test')
    expect(activityText('Bash', { command: 'x'.repeat(60) })).toBe(`Running ${'x'.repeat(39)}…`)
    expect(activityText('Grep', { pattern: 'TODO' })).toBe('Searching for TODO')
    expect(activityText('WebFetch', { url: 'https://example.com/a' })).toBe('Fetching example.com/a')
    expect(activityText('mcp__github__create_issue', {})).toBe('Using create_issue')
  })

  test("a workflow's name comes from the tool's name, else its script's meta", () => {
    expect(workflowName({ name: 'nightly' })).toBe('nightly')
    expect(workflowName({ script: "export const meta = {\n  name: 'review-changes',\n}" })).toBe('review-changes')
    expect(workflowName({})).toBe('workflow')
  })

  test("activity shows on a subagent's line, never over a helper's own report", () => {
    let run = addCard(addCard(newRun(0), 'h1', 'Helper', 0, 'helper'), 's1', 'Survey', 0, 'subagent')
    run = noteActivity(noteActivity(run, 'h1', 'Reading a'), 's1', 'Reading b')
    expect(run.cards.map(c => c.doing)).toEqual([undefined, 'Reading b'])
  })

  test('running lines come first, oldest on top; finished ones follow, the latest first', () => {
    let run = addCard(addCard(addCard(newRun(0), 'a', 'A', 1, 'subagent'), 'b', 'B', 2, 'subagent'), 'c', 'C', 3, 'subagent')
    run = finishCard(finishCard(run, 'b', true, 9), 'a', false, 5)
    expect(orderedCards(run).map(c => c.id)).toEqual(['c', 'b', 'a'])
  })

  test('on Default the header has no team, only the counts', () => {
    const run = queuePiece(addCard(newRun(0), 's1', 'Survey', 0, 'subagent'), 'Later')
    expect(headerText(run, 'default')).toBe('1 working · 1 queued')
  })
})

describe('finished lines', () => {
  test('stay for the session, the newest FINISHED_KEEP of them', () => {
    let run = newRun(0)
    for (let i = 0; i <= FINISHED_KEEP; i++) {
      run = finishCard(addCard(run, `a${i}`, `Task ${i}`, i, 'subagent'), `a${i}`, true, i + 1)
    }
    run = addCard(run, 'live', 'Still going', 99, 'subagent')
    expect(run.cards.filter(c => c.status === 'done')).toHaveLength(FINISHED_KEEP)
    expect(run.cards.some(c => c.id === 'a0')).toBe(false)
    expect(run.cards.some(c => c.id === 'live')).toBe(true)
  })
})

describe('Showing and Hide completed', () => {
  const run = finishCard(
    addCard(addCard(addCard(newRun(0), 'old', 'Old', 1_000, 'subagent'), 'wf', 'flow · agent 1', 5_000, 'workflow'), 'new', 'New', 9_000, 'subagent'),
    'old',
    true,
    2_000,
  )
  const ids = (view: Parameters<typeof visibleCards>[1]) => visibleCards(run.cards, view).map(c => c.id)
  const base = { showing: 'all' as const, hideAfter: 15 as const, requestAt: null, now: 60_000 }

  test('All shows every line; Tool agents leaves out workflow agents', () => {
    expect(ids(base)).toEqual(['old', 'wf', 'new'])
    expect(ids({ ...base, showing: 'tool' })).toEqual(['old', 'new'])
  })

  test('Current task shows those started since the last prompt, or all before any', () => {
    expect(ids({ ...base, showing: 'current', requestAt: 4_000 })).toEqual(['wf', 'new'])
    expect(ids({ ...base, showing: 'current' })).toEqual(['old', 'wf', 'new'])
  })

  test("a finished line goes once Hide completed's time is up; Immediate hides it at once", () => {
    expect(ids({ ...base, hideAfter: 1, now: 61_000 })).toEqual(['old', 'wf', 'new'])
    expect(ids({ ...base, hideAfter: 1, now: 62_000 })).toEqual(['wf', 'new'])
    expect(ids({ ...base, hideAfter: 0, now: 2_000 })).toEqual(['wf', 'new'])
    expect(ids({ ...base, hideAfter: 'never', now: 99 * 60 * 60_000 })).toEqual(['old', 'wf', 'new'])
  })

  test('the picks read Never, then minutes, then Immediate', () => {
    expect((['never', 15, 5, 1, 0] as const).map(hideAfterLabel)).toEqual(['Never', '15m', '5m', '1m', 'Immediate'])
  })
})
