// The model and file work happens in hooks/register.tsx: the engine only lets `$` be used in the hooks module itself.

export const HANDOFF_PROMPT =
  'Write a handoff brief so a fresh session with no memory of this conversation can continue the work. ' +
  'Use markdown with exactly these sections: ## Goal, ## Current state, ## Decisions made, ## Open tasks, ' +
  '## Key files, ## Next step. Be specific: name files, functions, commands and unresolved questions. ' +
  'Output only the brief.'

const pad = (n: number) => String(n).padStart(2, '0')

export function handoffPath(cwd: string, now: number, withSeconds = false): string {
  const d = new Date(now)
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${withSeconds ? pad(d.getSeconds()) : ''}`

  return `${cwd}/.claude/handoffs/${day}-${time}.md`
}
