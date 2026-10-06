import type { Elements } from 'claude-code'

import type { Checklist, ChecklistItem, ViewMode } from '../types'

/** The checklist tool's short name; the model calls it as `mcp__aitools__checklist`. */
export const CHECKLIST_TOOL = 'checklist'
export const CHECKLIST_TOOL_ID = 'mcp__aitools__checklist'

const STATUSES = ['todo', 'doing', 'done'] as const

export const CHECKLIST_SPEC = {
  name: CHECKLIST_TOOL,
  description:
    'Shows the person your plan and progress as a checklist above their prompt. Use it only when a system note says ' +
    'progress reporting is on. Send the whole list every call: a short title for the task and each step in plain ' +
    'language (an outcome, never a tool name, file path or code).',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What the task is, in a few words' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'One step, in plain language' },
            status: { type: 'string', enum: [...STATUSES] },
            percent: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'For the step in progress: your estimate of how far along it is',
            },
          },
          required: ['text', 'status'],
        },
      },
    },
    required: ['title', 'items'],
  },
}

const TASK_NOTE =
  `Progress reporting is on: the person follows your work through a checklist drawn from ${CHECKLIST_TOOL_ID}. ` +
  'If the request needs more than a quick answer, call it before you start with a short title and your plan as ' +
  '3 to 8 plain-language steps (outcomes, not tool names or code). Call it again with the whole list each time a ' +
  'step starts (status "doing") or finishes ("done"), with one step doing at a time; add, drop or reword steps when ' +
  'the plan changes. Give the step in progress a percent, your estimate of how far along it is, and send the list ' +
  'again as it moves (roughly every quarter of the step) so its progress bar keeps up. Mark every step done before ' +
  'your final reply. Skip the checklist for a quick question that needs no work.'

const CLEAN_NOTE =
  ' Clean View is on: the person sees only the checklist and your final reply, not your tool calls or anything you ' +
  'write before it. Do not narrate between steps; put what they need in a brief final reply.'

/** The views' names as the menu, the commands and their replies spell them. */
export const VIEW_NAMES = { task: 'Task View', clean: 'Clean View' } as const

/**
 * The view after `/taskview` or `/cleanview` with `args`: no argument toggles that view (turning it on replaces the
 * other), `on` sets it, `off` turns it off if it is the one on; null for anything else.
 */
export function nextView(current: ViewMode, view: 'task' | 'clean', args: string): ViewMode | null {
  const word = args.trim().toLowerCase()
  if (word === '') {
    return current === view ? 'off' : view
  }
  if (word === 'on') {
    return view
  }
  if (word === 'off') {
    return current === view ? 'off' : current
  }

  return null
}

/** The hidden note a prompt carries while a view is on; null when off. */
export function viewNote(mode: ViewMode): string | null {
  return mode === 'off' ? null : mode === 'clean' ? TASK_NOTE + CLEAN_NOTE : TASK_NOTE
}

/** The checklist tool's input as a Checklist, or the reason it is not one. */
export function parseChecklist(input: unknown): Checklist | string {
  const given = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const title = typeof given.title === 'string' ? given.title.trim() : ''
  if (!title) {
    return 'title must be a non-empty string'
  }
  if (!Array.isArray(given.items)) {
    return 'items must be an array of { text, status }'
  }
  const items: ChecklistItem[] = []
  for (const raw of given.items as unknown[]) {
    const item = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    const status = STATUSES.find(s => s === item.status)
    if (!text || !status) {
      return 'each item needs a non-empty text and a status of todo, doing or done'
    }
    const isPercent = typeof item.percent === 'number' && Number.isFinite(item.percent)
    const percent = isPercent ? clampPercent(item.percent as number) : undefined
    items.push(percent === undefined ? { text, status } : { text, status, percent })
  }

  return { title, items }
}

function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** How far along a step's bar is: full once done, empty before it starts, the model's estimate in between. */
export function stepPercent(item: ChecklistItem): number {
  return item.status === 'done' ? 100 : item.status === 'todo' ? 0 : (item.percent ?? 0)
}

/** Cells in a step's progress bar. */
export const BAR_CELLS = 10

/** A step's progress bar: filled cells for the share done, light cells for the rest. */
export function progressBar(percent: number, cells = BAR_CELLS): { filled: string; empty: string } {
  const n = Math.round((clampPercent(percent) / 100) * cells)

  return { filled: '▰'.repeat(n), empty: '▱'.repeat(cells - n) }
}

/** Whether Clean View shows an assistant text block: only one that is part of a finished turn's final reply. */
export function isFinalReply(text: string, finals: readonly string[]): boolean {
  const block = text.trim()

  return block.length > 0 && finals.some(final => final.includes(block))
}

/** How many final replies Clean View keeps to match against. */
export const FINALS_KEEP = 200

/** Keeps the newest finals, so the list Clean View matches against stays small. */
export function addFinal(finals: readonly string[], answer: string, keep = FINALS_KEEP): string[] {
  const text = answer.trim()

  return text && !finals.includes(text) ? [...finals, text].slice(-keep) : [...finals]
}

export type Row = { role: 'user' | 'assistant'; text: string; toolResults?: readonly unknown[] }

/**
 * Each request's final reply in a conversation: the last assistant text before the next prompt the person sent (a
 * user row carrying text and no tool results), and the conversation's last assistant text. Read when the mod loads,
 * so replies from turns that ended before it (a reload, a restart) still show in Clean View.
 */
export function finalReplies(rows: readonly Row[]): string[] {
  const finals: string[] = []
  let last = ''
  for (const row of rows) {
    if (row.role === 'assistant') {
      last = row.text.trim() || last
    } else if (row.text.trim() && !row.toolResults?.length) {
      if (last) finals.push(last)
      last = ''
    }
  }
  if (last) finals.push(last)

  return finals
}

type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const MARKS = { done: '✓', doing: '●', todo: '○' } as const
/** Done marks green, the step in progress blue (the mod's own shades); steps not started stay dim. */
export const GREEN = '#6fbe49'
export const BLUE = '#478487'
const MARK_COLORS = { done: GREEN, doing: BLUE, todo: undefined } as const
/** The step in progress: a grey between dim and full white, so it stands out without glaring. */
export const DOING_TEXT = '#b0b0b0'
/**
 * The bar's dim grey, named: the desktop draws `dimColor` in a pane nearly as light as DOING_TEXT, so pane text that
 * must read as faint as the bar's labels uses this instead.
 */
export const FAINT_TEXT = '#808080'

/** The checklist under the bar: the steps while work goes on, one line once every step is done. */
/** `onClose` clears the checklist: the × at the end of the folded Done line. */
export function renderChecklist(el: El, list: Checklist | null, isWorking: boolean, onClose: () => void) {
  const { Box, Text, Button } = el
  if (list === null) {
    return null
  }
  const done = list.items.filter(i => i.status === 'done').length
  if (!isWorking && list.items.length > 0 && done === list.items.length) {
    const steps = `${list.items.length} step${list.items.length === 1 ? '' : 's'}`
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexShrink={1}>
          <Text color={MARK_COLORS.done}>{`${MARKS.done} `}</Text>
          <Text dimColor wrap="truncate-end">{`Done: ${list.title} (${steps})`}</Text>
        </Box>
        <Button key="checklist-close" label="×" plain dimColor onPress={() => onClose()} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{list.title}</Text>
        <Text dimColor>{`${done} of ${list.items.length}`}</Text>
      </Box>
      {list.items.map((item, i) => {
        const percent = stepPercent(item)
        const bar = progressBar(percent)

        return (
          <Box key={`item-${i}`} flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" flexShrink={1}>
              <Text color={MARK_COLORS[item.status]} dimColor={item.status === 'todo'}>{`${MARKS[item.status]} `}</Text>
              <Text
                color={item.status === 'doing' ? DOING_TEXT : undefined}
                dimColor={item.status !== 'doing'}
                wrap="truncate-end"
              >
                {item.text}
              </Text>
            </Box>
            <Box flexDirection="row" flexShrink={0}>
              <Text key="pct" dimColor>{`${String(percent).padStart(3)}% `}</Text>
              <Text key="filled" color={MARK_COLORS[item.status]} dimColor={item.status !== 'doing'}>{bar.filled}</Text>
              <Text key="empty" dimColor>{bar.empty}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
