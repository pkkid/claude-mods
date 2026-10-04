import { describe, expect, test } from 'claude-code/testing'

import { handoffOutput } from '../src/handoff'

describe('handoffOutput', () => {
  test('wraps the brief in a markdown code fence under a title', () => {
    expect(handoffOutput('## Goal\nShip it')).toBe('Handoff brief\n\n```markdown\n## Goal\nShip it\n```')
  })

  test('fence outgrows backtick runs inside the brief', () => {
    const brief = '## Key files\n```bash\nls\n```'
    expect(handoffOutput(brief)).toBe(`Handoff brief\n\n\`\`\`\`markdown\n${brief}\n\`\`\`\``)
  })
})
