import { describe, expect, test } from 'claude-code/testing'

import { handoffPath } from '../src/handoff'

describe('handoffPath', () => {
  const at = new Date(2026, 9, 4, 9, 5, 7).getTime()

  test('minute resolution', () => expect(handoffPath('/p', at)).toBe('/p/.claude/handoffs/2026-10-04-0905.md'))

  test('with seconds', () => expect(handoffPath('/p', at, true)).toBe('/p/.claude/handoffs/2026-10-04-090507.md'))
})
