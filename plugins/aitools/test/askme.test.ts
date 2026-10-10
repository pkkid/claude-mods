import { describe, expect, test } from 'claude-code/testing'

import { ASKME_PROMPT, askmeText } from '../src/askme'

describe('askmeText', () => {
  test('asks for pop-up choices with a recommendation first', () => {
    expect(ASKME_PROMPT).toContain('AskUserQuestion')
    expect(ASKME_PROMPT).toContain('(Recommended)')
  })

  test('sends the prompt alone without a note, and adds the note when given', () => {
    expect(askmeText('')).toBe(ASKME_PROMPT)
    expect(askmeText('   ')).toBe(ASKME_PROMPT)
    expect(askmeText(' only the M2 ones ')).toBe(`${ASKME_PROMPT}\n\nAlso: only the M2 ones`)
  })
})
