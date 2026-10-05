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

/** The most a Markdown element draws; a longer brief is cut in the pane, while Copy still takes all of it. */
export const MARKDOWN_MAX = 10_000

const CUT_NOTE = '\n\n_(Cut to fit the pane; Copy takes the whole brief.)_'

/** The brief as the handoff pane draws it, cut to fit the Markdown element's limit. */
export function paneMarkdown(brief: string): string {
  return brief.length <= MARKDOWN_MAX ? brief : brief.slice(0, MARKDOWN_MAX - CUT_NOTE.length) + CUT_NOTE
}
