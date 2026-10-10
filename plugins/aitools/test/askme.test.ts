import { describe, expect, test } from 'claude-code/testing'

import { ASKME_PROMPT, ASK_TOOL, askmeText, asksQuestions, isAskableIn } from '../src/askme'

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

describe('asksQuestions', () => {
  test('a question anywhere in the prose, past closing marks', () => {
    expect(asksQuestions('Done. Which name do you want?')).toBe(true)
    expect(asksQuestions('Two things:\n1. **Keep the old flag?**\n2. Rename it.\n\nThen I will push.')).toBe(true)
    expect(asksQuestions('Is it ready (for now)?')).toBe(true)
    expect(asksQuestions('Should it use `askme`?')).toBe(true)
  })

  test('not a bare question mark, one inside code or a URL, nor none at all', () => {
    expect(asksQuestions('Done. The tests pass.')).toBe(false)
    expect(asksQuestions('See https://example.com/search?q=askme for more.')).toBe(false)
    expect(asksQuestions('It matches `a?b` and\n```\nwhy? not\n```\nnothing else.')).toBe(false)
    expect(asksQuestions('The **?** button now sits left of tools.')).toBe(false)
    expect(asksQuestions('A bare ? on its own line:\n?\nasks nothing.')).toBe(false)
    expect(asksQuestions('')).toBe(false)
  })
})

describe('isAskableIn', () => {
  const user = (text: string) => ({ role: 'user' as const, text })
  const assistant = (text: string, tools: string[] = []) => ({ role: 'assistant' as const, text, toolUses: tools.map(tool => ({ tool })) })
  const result = { role: 'user' as const, text: '', toolResults: [{}] }

  test('the last reply asks and no pop-up was opened since the prompt', () => {
    expect(isAskableIn([user('Help'), assistant('', ['Read']), result, assistant('Which file?')])).toBe(true)
  })

  test('a pop-up since the prompt, an answered reply, a statement, or nothing yet', () => {
    expect(isAskableIn([user('Help'), assistant('', [ASK_TOOL]), result, assistant('Which file?')])).toBe(false)
    expect(isAskableIn([user('Help'), assistant('Which file?'), user('bar.tsx')])).toBe(false)
    expect(isAskableIn([user('Help'), assistant('Done.')])).toBe(false)
    expect(isAskableIn([])).toBe(false)
  })

  test("an earlier request's pop-up does not count", () => {
    expect(isAskableIn([user('Help'), assistant('', [ASK_TOOL]), result, assistant('Done.'), user('Next'), assistant('Which file?')])).toBe(true)
  })
})
