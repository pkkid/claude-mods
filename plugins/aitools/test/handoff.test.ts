import { describe, expect, test } from 'claude-code/testing'

import { MARKDOWN_MAX, handoffOutput, paneMarkdown } from '../src/handoff'

describe('handoffOutput', () => {
  test('a title line, then the brief as markdown the chat renders', () => {
    expect(handoffOutput('## Goal\nShip it')).toBe('Handoff brief\n\n## Goal\nShip it')
  })
})

describe('paneMarkdown', () => {
  test('keeps a brief that fits and cuts a longer one to the Markdown limit with a note', () => {
    expect(paneMarkdown('## Goal\nShip it')).toBe('## Goal\nShip it')
    const cut = paneMarkdown('x'.repeat(MARKDOWN_MAX + 50))
    expect(cut.length).toBe(MARKDOWN_MAX)
    expect(cut).toContain('Copy takes the whole brief')
  })
})
