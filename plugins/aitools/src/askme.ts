/**
 * /askme: asks Claude to put the questions from its last answer to the person as pop-up choices, each with a
 * recommendation, instead of leaving them as prose to answer by typing.
 */

export const ASKME_PROMPT =
  'Look at your previous response and find every question or decision you left for me. Ask them again with the ' +
  'AskUserQuestion tool instead of in prose.\n' +
  '- One question per decision. Make each question self-contained: the pop-up hides your earlier response, so ' +
  'say in a sentence what it is about.\n' +
  '- Give 2 to 4 concrete options. Put the one you recommend first and end its label with "(Recommended)". Each ' +
  "option's description says what choosing it means or costs, in one line.\n" +
  '- Group plain confirm-or-reverse items four to a multiSelect question: "Which of these should change? Select ' +
  'none to confirm all."\n' +
  '- Ask at most 4 questions per call, most important first, and keep calling until every question has an ' +
  'answer. Follow up on any answer given as "Other" before treating it as decided.\n' +
  'Then list the decisions in one short summary and carry on with the work they unblock. If your previous ' +
  'response left no questions, say so in one line and stop.'

/** The prompt for `/askme [extra]`: the extra words, when given, ride along as the person's own note. */
export function askmeText(args: string): string {
  const extra = args.trim()
  return extra === '' ? ASKME_PROMPT : `${ASKME_PROMPT}\n\nAlso: ${extra}`
}
