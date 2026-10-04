export const HANDOFF_PROMPT =
  'Write a handoff brief so a fresh session with no memory of this conversation can continue the work. ' +
  'Use markdown with exactly these sections: ## Goal, ## Current state, ## Decisions made, ## Open tasks, ' +
  '## Key files, ## Next step. Be specific: name files, functions, commands and unresolved questions. ' +
  'Output only the brief.'

/** The chat row for a brief: a title, then the brief as raw markdown in a fence longer than any backtick run inside it. */
export function handoffOutput(brief: string): string {
  const longestRun = Math.max(0, ...(brief.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))

  return `Handoff brief\n\n${fence}markdown\n${brief}\n${fence}`
}
