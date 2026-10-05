# aitools

A one-row bar above the prompt showing how close your Claude subscription is to its limits, and what the work would
cost at Anthropic API list prices.

```
AI Tools    5h 42% ·1h12m    wk 18% ·Thu    ctx 31% 62k/200k    cache 42m    thread $3.12 (+$0.41)    month $184.20    limit ~3:40pm   [🛠] [⁝]
```

| Segment | Meaning |
|---|---|
| `AI Tools` | A dim label naming the bar |
| `5h 42% ·1h12m` | 5-hour usage window: percent used, time until it resets |
| `wk 18% ·Thu` | Weekly window: percent used, the day it resets (hours when under a day) |
| `ctx 31% 62k/200k` | Context window fill: percent and tokens used / window size |
| `cache 42m` | How long the prompt cache should stay warm: Claude Code writes the main conversation's cache with a 1-hour TTL, restarted by every request. Amber under 10 minutes, `cache cold` once expired. An estimate from request times; the API does not report cache state, and Anthropic may evict early |
| `thread $3.12` | This session's cost at API prices |
| `(+$0.41)` | What the last turn cost (`last $0.41` when thread cost is hidden) |
| `month $184.20` | This calendar month's Claude Code usage at API prices, across all sessions on this machine |
| `limit ~3:40pm` | At your pace over the last hour, when the 5-hour window would run out; shown only if before it resets |

Usage and context turn yellow at 70% and red at 90%. A value not known yet shows `—`; until the first response of a
session the bar shows the figures from your previous session.

## Show or hide the bar

`/aitools` toggles the whole bar (buttons included); `/aitools on` and `/aitools off` set it. The choice holds across
sessions. `/handoff` works either way.

## Settings

Press **⁝** to open the options above the bar, five to a row, and toggle any of: the AI Tools label, 5-hour usage,
weekly usage, reset countdowns, context %, context tokens, cache warmth, thread cost, last-turn cost, monthly cost,
burn-rate projection, threshold colors, threshold alerts, Tools menu. Changes show in the bar right away and are saved
across sessions. Press **⁝** again to close it; opening it closes the **🛠** menu, and the other way round.

Threshold alerts are one-time toasts when the 5-hour or weekly window passes 90%, and when context passes 80%.

## Handoff

`/handoff` asks the current conversation for a brief (goal, current state, decisions, open tasks, key
files, next step), prints it in the chat as formatted text, and copies the raw markdown to the clipboard. Paste it into a new session to
continue there. The brief is a command output row, so the current session's model reads it too.

The **🛠** button opens a row above the bar with **Handoff**, **Workflows**, **Task View** and **Clean View**,
right-aligned; press it again to close the row without picking. **Handoff** writes the same brief into a **Handoff brief** pane, drawn as formatted text with
a **Copy** button; nothing is copied until you press it, and the brief stays out of the chat (so the current session's
model does not read it). **Workflows** runs Claude Code's built-in `/workflows` directly where the
engine has it (the terminal); in the desktop Code tab, which answers a typed `/workflows` itself, it puts `/workflows`
in the prompt box for you to send with Enter.

## Task View and Clean View

Two views from the **🛠** menu that turn Claude's work into a checklist under the bar (an open menu still shows
above it): done steps marked with a green ✓, the step in progress with a blue ●, steps not started with a dim ○.
In the menu a ● marks the view that is on and a ○ the one that is off; picking the one that is on turns it off, and
picking the other switches. The choice holds across sessions.

```
Adding dark mode                                                    3 of 5
✓ Read the theme code                                   100% ██████████
✓ Add the color tokens                                  100% ██████████
● Wire up the toggle                                     40% ████░░░░░░
○ Update tests                                            0% ░░░░░░░░░░
○ Run checks                                              0% ░░░░░░░░░░
```

Each step has a bar: full once done, empty until it starts, and for the step in progress Claude's own estimate of how
far along it is, which moves each time Claude updates the checklist (the note asks for about every quarter of a step).

- **Task View** shows the checklist and leaves the chat as it is (only the checklist tool's own rows are hidden).
- **Clean View** shows the checklist and hides every tool call and everything Claude writes while it works; only the
  final reply of each finished request stays. It hides tool calls and in-progress replies already in the chat too.

While a view is on, each prompt you send carries a hidden note asking Claude to plan the work as plain-language steps
and report them through the mod's `checklist` tool (`mcp__aitools__checklist`), updating it as each step starts and
finishes. The mod answers that tool itself, before Claude Code's permission check, so it
should not ask for permission. Each new prompt starts a fresh checklist;
once every step is done and Claude stops, it folds to one line, `✓ Done: <title> (<n> steps)`. A quick question that
needs no work gets no checklist.

Clean View recognizes a final reply as the last thing Claude wrote before your next prompt. It reads them from the
conversation when the mod loads (so replies from before a reload or restart still show) and adds each new one as a
request finishes.

## How monthly cost is computed

The mod reads Claude Code's own transcripts (`~/.claude/projects/**/*.jsonl`, or under `CLAUDE_CONFIG_DIR`), counts
each assistant response once (by message id) when its timestamp falls in the current month, and prices its token usage
(input, output, cache writes at the 5-minute or 1-hour rate, cache reads) with the table in `src/pricing.ts` (API list
prices as of 2026-09-25). Only bytes added since the last scan are read; the cache lives in the mod's store and resets
each month. A `~` before a figure means part of it used an estimated rate (an unknown model priced by its family) or a
file could not be read.

## Limits

- Claude Code only: the Code tab in Claude Desktop and the terminal. Conversations in Claude Desktop's chat tab are not
  visible to mods and are not counted.
- Usage percentages come from the API's rate-limit headers, so they update after each response.
- Dollar figures are what the same tokens would cost on the API, not what the subscription costs.
