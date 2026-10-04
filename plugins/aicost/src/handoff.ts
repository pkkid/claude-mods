export const HANDOFF_PROMPT =
  'Write a handoff brief so a fresh session with no memory of this conversation can continue the work. ' +
  'Use markdown with exactly these sections: ## Goal, ## Current state, ## Decisions made, ## Open tasks, ' +
  '## Key files, ## Next step. Be specific: name files, functions, commands and unresolved questions. ' +
  'Output only the brief.'

/**
 * The chat row for a brief, which the chat renders as markdown. The title line comes first because the engine
 * prefixes the row with the plugin's name, which would otherwise swallow the first heading.
 */
export function handoffOutput(brief: string): string {
  return `Handoff brief\n\n${brief}`
}
