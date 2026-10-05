import { describe, expect, test } from 'claude-code/testing'

import {
  addCard,
  dockNote,
  finishLine,
  finishCard,
  headerText,
  isRunning,
  isTeamSize,
  newRun,
  queuePiece,
  reportProgress,
} from '../src/agentdock'
import { elapsed } from '../src/format'

describe('agent runs', () => {
  test('a started helper gets a running card and leaves the queue', () => {
    const run = addCard(queuePiece(queuePiece(newRun(0), 'Draft'), 'Draft'), 'a1', 'Draft', 5)
    expect(run.queued).toEqual([])
    expect(run.cards).toEqual([{ id: 'a1', task: 'Draft', status: 'running', startedAt: 5 }])
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
  test('team sizes are the six offered', () => {
    expect([1, 3, 5, 10, 20, 30].every(isTeamSize)).toBe(true)
    expect(isTeamSize(4)).toBe(false)
    expect(isTeamSize('5')).toBe(false)
  })

  test('the note names the team size, one helper reading as one', () => {
    expect(dockNote(5)).toContain('up to 5 helper agents at once')
    expect(dockNote(1)).toContain('a team of 1 helper agent for')
  })

  test('the header shows the team, then only the counts that are not zero', () => {
    expect(headerText(null, 5)).toBe('5 agents · 5 idle')
    let run = queuePiece(addCard(addCard(newRun(0), 'a1', 'A', 0), 'a2', 'B', 0), 'C')
    run = finishCard(run, 'a2', true, 1)
    expect(headerText(run, 1)).toBe('1 agent · 1 working · 1 queued · 1 done')
  })

  test('elapsed reads as minutes and seconds, hours once past one', () => {
    expect(elapsed(65_000)).toBe('1:05')
    expect(elapsed(3_725_000)).toBe('1:02:05')
    expect(elapsed(-5)).toBe('0:00')
  })

  test('the finish line says how many helpers finished and how long they took', () => {
    const pair = addCard(addCard(newRun(0), 'a1', 'A', 0), 'a2', 'B', 0)
    const two = finishCard(finishCard(pair, 'a1', true, 6_000), 'a2', true, 10_000)
    expect(finishLine(two, 0)).toBe('All 2 helpers finished in 6 to 10 seconds each.')
    const one = finishCard(addCard(newRun(0), 'a1', 'A', 0), 'a1', true, 1_000)
    expect(finishLine(one, 0)).toBe('The helper finished in 1 second.')
    const slow = finishCard(finishCard(pair, 'a1', true, 40_000), 'a2', false, 80_000)
    expect(finishLine(slow, 0)).toBe('1 of 2 helpers finished and 1 failed, in 0:40 to 1:20 each.')
  })
})
