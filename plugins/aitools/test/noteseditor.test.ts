import { describe, expect, test } from 'claude-code/testing'

import { applyKey, cursorAt, indexAt, layout } from '../src/noteseditor'
import type { Editor } from '../src/noteseditor'

/** Types `keys` into an editor `columns` wide, one key at a time. */
function typed(ed: Editor, keys: (string | { key: string; ctrl?: true })[], columns = 10): Editor {
  return keys.reduce((now, k) => applyKey(now, typeof k === 'string' ? { key: k } : k, columns) ?? now, ed)
}

describe('notes editor', () => {
  test('lines wrap at the width; an empty line is still a row', () => {
    expect(layout('abcdefgh\n\nxy', 5)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 8 },
      { start: 9, end: 9 },
      { start: 10, end: 12 },
    ])
    expect(layout('', 5)).toEqual([{ start: 0, end: 0 }])
  })

  test('at a wrap the cursor sits at the start of the next piece; at a line end, on that line', () => {
    const rows = layout('abcdefgh\nxy', 5)
    expect(cursorAt(rows, 5)).toEqual({ row: 1, col: 0 })
    expect(cursorAt(rows, 8)).toEqual({ row: 1, col: 3 })
    expect(indexAt(rows, 2, 9)).toBe(11)
    expect(indexAt(rows, -3, 2)).toBe(2)
  })

  test('typing, pasting and Enter insert at the cursor; Backspace and Delete remove', () => {
    let ed = typed({ text: '', cursor: 0 }, ['h', 'i', 'return', 'line one\r\nline two'])
    expect(ed).toEqual({ text: 'hi\nline one\nline two', cursor: 20 })
    // Space arrives by name, as the special keys do.
    expect(typed({ text: '', cursor: 0 }, ['a', 'space', 'b'])).toEqual({ text: 'a b', cursor: 3 })
    ed = typed({ text: 'abc', cursor: 1 }, ['backspace', 'delete'])
    expect(ed).toEqual({ text: 'c', cursor: 0 })
    expect(typed({ text: 'abc', cursor: 0 }, ['backspace'])).toEqual({ text: 'abc', cursor: 0 })
  })

  test('the arrows, Home and End move over the visual rows', () => {
    const start = { text: 'abcdefgh\nxy', cursor: 7 }
    expect(typed(start, ['up'], 5).cursor).toBe(2)
    expect(typed(start, ['down'], 5).cursor).toBe(11)
    expect(typed(start, ['down', 'down'], 5).cursor).toBe(11)
    expect(typed(start, ['home'], 5).cursor).toBe(5)
    expect(typed(start, [{ key: 'e', ctrl: true }], 5).cursor).toBe(8)
    expect(typed({ text: 'ab', cursor: 1 }, ['up']).cursor).toBe(0)
  })

  test('keys with no meaning here, and other Ctrl keys, change nothing', () => {
    expect(applyKey({ text: 'a', cursor: 1 }, { key: 'escape' }, 10)).toBeNull()
    expect(applyKey({ text: 'a', cursor: 1 }, { key: 'f5' }, 10)).toBeNull()
    expect(applyKey({ text: 'a', cursor: 1 }, { key: 's', ctrl: true }, 10)).toBeNull()
  })
})
