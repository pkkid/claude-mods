import { describe, expect, test } from 'claude-code/testing'

import { addFinal, finalReplies, isFinalReply, nextView, parseChecklist, progressBar, stepPercent, viewNote } from '../src/checklist'

describe('parseChecklist', () => {
  test('reads a title and steps, trimming text', () => {
    expect(parseChecklist({ title: ' Dark mode ', items: [{ text: ' Add tokens ', status: 'done' }, { text: 'Wire toggle', status: 'doing' }] }))
      .toEqual({ title: 'Dark mode', items: [{ text: 'Add tokens', status: 'done' }, { text: 'Wire toggle', status: 'doing' }] })
  })

  test('keeps a percent, rounded and held to 0 to 100, and drops one that is not a number', () => {
    const parsed = parseChecklist({
      title: 'x',
      items: [
        { text: 'a', status: 'doing', percent: 42.6 },
        { text: 'b', status: 'doing', percent: 140 },
        { text: 'c', status: 'doing', percent: 'half' },
      ],
    })
    expect(typeof parsed === 'string' ? parsed : parsed.items.map(i => i.percent)).toEqual([43, 100, undefined])
  })

  test('explains a missing title, a missing list or a bad step', () => {
    expect(parseChecklist({ items: [] })).toBe('title must be a non-empty string')
    expect(parseChecklist({ title: 'x' })).toBe('items must be an array of { text, status }')
    expect(parseChecklist({ title: 'x', items: [{ text: 'a', status: 'started' }] })).toContain('status of todo, doing or done')
  })
})

describe('progress bars', () => {
  test('done steps are full, steps not started empty, the step in progress at its estimate', () => {
    expect(stepPercent({ text: 'a', status: 'done', percent: 10 })).toBe(100)
    expect(stepPercent({ text: 'a', status: 'todo', percent: 50 })).toBe(0)
    expect(stepPercent({ text: 'a', status: 'doing', percent: 40 })).toBe(40)
    expect(stepPercent({ text: 'a', status: 'doing' })).toBe(0)
  })

  test('a bar fills its share of cells', () => {
    expect(progressBar(40)).toEqual({ filled: '████', empty: '░░░░░░' })
    expect(progressBar(0)).toEqual({ filled: '', empty: '░░░░░░░░░░' })
    expect(progressBar(100, 4)).toEqual({ filled: '████', empty: '' })
  })
})

describe('nextView', () => {
  test('no argument toggles the view, replacing the other; on sets it; off clears only that view', () => {
    expect(nextView('off', 'clean', '')).toBe('clean')
    expect(nextView('clean', 'clean', '')).toBe('off')
    expect(nextView('task', 'clean', '')).toBe('clean')
    expect(nextView('task', 'clean', ' ON ')).toBe('clean')
    expect(nextView('clean', 'clean', 'off')).toBe('off')
    expect(nextView('task', 'clean', 'off')).toBe('task')
    expect(nextView('off', 'task', 'maybe')).toBeNull()
  })
})

describe('viewNote', () => {
  test('none when off; Clean View adds the hidden-replies note to Task View', () => {
    expect(viewNote('off')).toBeNull()
    expect(viewNote('task')).toContain('mcp__aitools__checklist')
    expect(viewNote('task')).toContain('Give the step in progress a percent')
    expect(viewNote('task')).not.toContain('Clean View')
    expect(viewNote('clean')).toContain('Clean View is on')
  })
})

describe('final replies', () => {
  test('a block shows when it is part of a final reply, never when empty', () => {
    const finals = addFinal([], '  All done.\n\nThe toggle works.  ')
    expect(isFinalReply('The toggle works.', finals)).toBe(true)
    expect(isFinalReply('Let me read the theme first.', finals)).toBe(false)
    expect(isFinalReply('   ', finals)).toBe(false)
  })

  test('keeps the newest finals and skips empty or repeated answers', () => {
    expect(addFinal(['a', 'b'], 'c', 2)).toEqual(['b', 'c'])
    expect(addFinal(['a'], '  ')).toEqual(['a'])
    expect(addFinal(['a'], 'a')).toEqual(['a'])
  })

  test("finalReplies takes each request's last assistant text, skipping tool results and narration", () => {
    const rows = [
      { role: 'user' as const, text: 'Add dark mode' },
      { role: 'assistant' as const, text: 'Let me look at the theme.' },
      { role: 'user' as const, text: '', toolResults: [{}] },
      { role: 'assistant' as const, text: '' },
      { role: 'user' as const, text: 'ok', toolResults: [{}] },
      { role: 'assistant' as const, text: 'Dark mode is in.' },
      { role: 'user' as const, text: 'Thanks, now tests' },
      { role: 'assistant' as const, text: 'Tests pass.' },
    ]
    expect(finalReplies(rows)).toEqual(['Dark mode is in.', 'Tests pass.'])
    expect(finalReplies([])).toEqual([])
  })
})
