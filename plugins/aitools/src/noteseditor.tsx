/**
 * The Notes pane's text box: a `Client` surface module, so it takes keys and clicks itself. It keeps the text and the
 * cursor in its own state, draws the text wrapped to its region with the cursor as an inverted cell, and posts the
 * whole text to the hooks module after every change, which saves it.
 *
 * A click places the cursor; typing and pasting insert, Enter starts a new line, the arrows, Home and End move
 * (Ctrl+A and Ctrl+E too), Backspace and Delete remove, Page Up and Page Down move ten rows. Escape hands the keys back
 * to the prompt.
 */

import type { ClientKeyEvent, ClientSurface } from 'claude-code'

/** What the hooks module hands the box: the note as saved, and the pane's width for the first layout. */
export type NotesProps = { text: string; columns: number }
/** The text and where the cursor sits in it, as an index. */
export type Editor = { text: string; cursor: number }
/** A visual row: the part of the text from `start` to `end`, a line or one wrapped piece of it. */
export type Row = { start: number; end: number }

/** The fewest rows the box takes, so an empty note still looks like a place to write. */
export const MIN_ROWS = 10
/** How far Page Up and Page Down move. */
const PAGE = 10
export const PLACEHOLDER = 'Click here and type your notes.'

/** Keys with a name of their own (and F1 to F24); anything else is text typed or pasted. */
const NAMED = new Set([
  'up', 'down', 'left', 'right', 'return', 'enter', 'tab', 'backspace', 'delete', 'pageup', 'pagedown', 'home', 'end',
  'escape', 'esc', 'insert', 'clear', 'space',
])
const FUNCTION_KEY = /^f\d{1,2}$/

/** The text's visual rows at `columns` wide: each line, cut into pieces where it is longer. */
export function layout(text: string, columns: number): Row[] {
  const width = Math.max(1, columns)
  const rows: Row[] = []
  let start = 0
  for (const line of text.split('\n')) {
    if (line.length === 0) {
      rows.push({ start, end: start })
    }
    for (let i = 0; i < line.length; i += width) {
      rows.push({ start: start + i, end: start + Math.min(i + width, line.length) })
    }
    start += line.length + 1
  }

  return rows
}

/** The row the cursor is on, and its column there: at a wrap, the start of the next piece. */
export function cursorAt(rows: readonly Row[], cursor: number): { row: number; col: number } {
  let row = 0
  for (let r = 0; r < rows.length; r++) {
    if (rows[r]!.start <= cursor) row = r
  }

  return { row, col: cursor - rows[row]!.start }
}

/** The index at a row and column, held to the row's length (and to the rows there are). */
export function indexAt(rows: readonly Row[], row: number, col: number): number {
  const r = rows[Math.min(Math.max(0, row), rows.length - 1)]!

  return r.start + Math.min(Math.max(0, col), r.end - r.start)
}

const insert = (ed: Editor, s: string): Editor => ({
  text: ed.text.slice(0, ed.cursor) + s + ed.text.slice(ed.cursor),
  cursor: ed.cursor + s.length,
})

/** The editor after one key at `columns` wide, or null when the key does nothing here. */
export function applyKey(ed: Editor, event: ClientKeyEvent, columns: number): Editor | null {
  const { key } = event
  const rows = layout(ed.text, columns)
  const at = cursorAt(rows, ed.cursor)
  const move = (cursor: number): Editor => ({ ...ed, cursor })
  if (event.ctrl || event.meta) {
    if (key === 'a') return move(rows[at.row]!.start)
    if (key === 'e') return move(rows[at.row]!.end)
    return null
  }
  switch (key) {
    case 'return':
    case 'enter':
      return insert(ed, '\n')
    case 'tab':
      return insert(ed, '  ')
    case 'space':
      return insert(ed, ' ')
    case 'backspace':
      return ed.cursor === 0 ? ed : { text: ed.text.slice(0, ed.cursor - 1) + ed.text.slice(ed.cursor), cursor: ed.cursor - 1 }
    case 'delete':
      return { ...ed, text: ed.text.slice(0, ed.cursor) + ed.text.slice(ed.cursor + 1) }
    case 'left':
      return move(Math.max(0, ed.cursor - 1))
    case 'right':
      return move(Math.min(ed.text.length, ed.cursor + 1))
    case 'up':
      return move(at.row === 0 ? 0 : indexAt(rows, at.row - 1, at.col))
    case 'down':
      return move(at.row === rows.length - 1 ? ed.text.length : indexAt(rows, at.row + 1, at.col))
    case 'pageup':
      return move(indexAt(rows, at.row - PAGE, at.col))
    case 'pagedown':
      return move(indexAt(rows, at.row + PAGE, at.col))
    case 'home':
      return move(rows[at.row]!.start)
    case 'end':
      return move(rows[at.row]!.end)
  }
  if (NAMED.has(key) || FUNCTION_KEY.test(key) || key.length === 0) {
    return null
  }

  // Typed or pasted text; a paste's line breaks come as \r\n or \r on some terminals.
  return insert(ed, key.replace(/\r\n?/g, '\n'))
}

export default function NotesEditor(props: NotesProps, surface: ClientSurface<Editor>) {
  const { Box, Text } = surface.elements
  const columns = surface.columns || props.columns || 60
  const ed = surface.state ?? { text: props.text, cursor: props.text.length }
  const rows = layout(ed.text, columns)
  const at = cursorAt(rows, ed.cursor)

  // Listeners read the state as it stands when the key or click arrives, not as it was drawn.
  surface.onKey(event => {
    const now = surface.state ?? ed
    const next = applyKey(now, event, columns)
    if (next === null) return
    surface.setState(next)
    if (next.text !== now.text) surface.post({ text: next.text })
  })
  surface.onPointer(event => {
    if (event.type !== 'down') return
    const now = surface.state ?? ed
    surface.setState({ ...now, cursor: indexAt(layout(now.text, columns), event.y, event.x) })
  })

  const lines = rows.map((r, i) => {
    const text = ed.text.slice(r.start, r.end)
    if (i !== at.row) {
      return <Text key={`row-${i}`}>{text || ' '}</Text>
    }
    const under = text.slice(at.col, at.col + 1)
    return (
      <Text key={`row-${i}`}>
        {text.slice(0, at.col)}
        <Text inverse>{under || ' '}</Text>
        {text.slice(at.col + 1)}
        {ed.text.length === 0 && <Text dimColor>{PLACEHOLDER}</Text>}
      </Text>
    )
  })
  const pad = Array.from({ length: Math.max(0, MIN_ROWS - lines.length) }, (_, i) => <Text key={`pad-${i}`}> </Text>)

  return (
    <Box flexDirection="column">
      {lines}
      {pad}
    </Box>
  )
}
