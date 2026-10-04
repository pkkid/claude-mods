import { describe, expect, test } from 'claude-code/testing'

import { handoffOutput } from '../src/handoff'

describe('handoffOutput', () => {
  test('a title line, then the brief as markdown the chat renders', () => {
    expect(handoffOutput('## Goal\nShip it')).toBe('Handoff brief\n\n## Goal\nShip it')
  })
})
