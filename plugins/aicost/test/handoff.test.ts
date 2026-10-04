import { describe, expect, test } from 'claude-code/testing'

import { handoffOutput, parseHandoffOutput } from '../src/handoff'

describe('handoffOutput', () => {
  test('wraps the brief in a markdown code fence under a title', () => {
    expect(handoffOutput('## Goal\nShip it')).toBe('Handoff brief\n\n```markdown\n## Goal\nShip it\n```')
  })

  test('fence outgrows backtick runs inside the brief', () => {
    const brief = '## Key files\n```bash\nls\n```'
    expect(handoffOutput(brief)).toBe(`Handoff brief\n\n\`\`\`\`markdown\n${brief}\n\`\`\`\``)
  })
})

describe('parseHandoffOutput', () => {
  test('recovers the brief from the row text', () => {
    const brief = '## Key files\n```bash\nls\n```'
    expect(parseHandoffOutput(handoffOutput(brief))).toBe(brief)
  })

  test('tolerates the plugin-name prefix', () => {
    expect(parseHandoffOutput(`aicost: ${handoffOutput('## Goal\nX')}`)).toBe('## Goal\nX')
  })

  test('null for other text', () => expect(parseHandoffOutput('Handoff failed: nothing to hand off yet')).toBeNull())
})
