# aitools

A one-row bar above the prompt showing how close your Claude subscription is to its limits, and what the work would
cost at Anthropic API list prices.

```
AI Tools    5h 42%, 1h12m    wk 18%, Thu    ctx 31% 62k/200k    tok 1.3M (+48k)    cache 42m    thread $3.12 (+$0.41)    month $184.20    limit ~3:40pm   [🛠] [⁝]
```

| Segment | Meaning |
|---|---|
| Clawd | The mascot, at the start of the bar in the desktop Code tab only (see below) |
| `AI Tools` | A dim title naming the bar |
| `5h 42%, 1h12m` | 5-hour usage window: percent used, time until it resets |
| `wk 18%, Thu` | Weekly window: percent used, the day it resets (hours when under a day) |
| `ctx 31% 62k/200k` | Context window fill: percent and tokens used / window size |
| `tok 1.3M (+48k)` | Tokens: this thread's total this month (its helpers' included) and the last turn's, counting input, output and prompt-cache reads and writes |
| `cache 42m` | How long the prompt cache should stay warm: Claude Code writes the main conversation's cache with a 1-hour TTL, restarted by every request. Amber under 10 minutes, `cache cold` once expired. An estimate from request times; the API does not report cache state, and Anthropic may evict early |
| `thread $3.12` | This session's cost at API prices |
| `(+$0.41)` | What the last turn cost (`last $0.41` when thread cost is hidden) |
| `~2.1% wk (+0.03%)` | Thread cost %: the thread's and the last turn's estimated share of your weekly allowance (see below) |
| `month $184.20` | This calendar month's Claude Code usage at API prices, across all sessions on this machine |
| `limit ~3:40pm` | At your pace over the last hour, when the 5-hour window would run out; shown only if before it resets |

Labels are dim and values a lighter grey; usage and context values turn yellow at 70% and red at 90%. A value not known yet shows `—`; until the first response of a
session the bar shows the figures from your previous session.

## Show or hide the bar

`/aitools` toggles the whole bar (buttons included); `/aitools on` and `/aitools off` set it. The choice holds across
sessions. `/handoff` works either way.

## Settings

Press **⁝** to open the options above the bar, five to a row, and toggle any of: (in the desktop Code tab only,
leading the first row) the mascot, the title, 5-hour usage,
weekly usage, reset countdowns, context %, context tokens, thread tokens, last-turn tokens, cache warmth, thread cost,
last-turn cost, thread cost %, monthly cost, burn-rate projection, threshold colors. The **🛠** button always shows.
Changes show in the bar right away and are saved across sessions. An option that is off does no work in the
background: the transcript scan runs only for monthly cost, thread tokens or thread cost %; the cost lookups only for
the cost options; the cache timer only for cache warmth; the mascot follows nothing while hidden. Turned back on, an
option catches up at once, except the burn-rate projection, which needs fresh samples (a few responses) to project
from. Hiding the bar with `/aitools off` stops all of it. Press **⁝** again to close it; opening it closes the
**🛠** menu, and the other way round.

## Mascot

In the desktop Code tab, Clawd, Claude Code's pixel mascot, stands at the start of the bar (48 × 20 px) and acts out
what Claude is doing. Every pose is animated, and a change of pose plays a short transition first: he walks over to his
laptop or paper, sits down to sleep, jolts awake.

| Pose | When |
|---|---|
| Waving | A new session starts (a few seconds) |
| Standing | Nothing is running: breathing, blinking, glancing around |
| Typing | A turn is running: tapping at a laptop beside him, code typing out on its screen |
| Reading | A read-only tool runs (Read, Grep, Glob, a web fetch or search): reading a sheet of paper |
| Puzzled | A question waits on you: an open AskUserQuestion dialog, or a reply that ends with a question mark. Your next prompt settles it |
| Celebrating | A turn finishes with an answer (a few seconds, then Standing) |
| Oops | A tool call fails or is refused, or a turn is interrupted or fails (a few seconds) |
| Sleeping | Standing idle for 5 minutes; your next prompt wakes him |

He is SVG, so he never shows in the terminal, and **Mascot** in the **⁝** menu (on by default) is offered on the
desktop only.

## Handoff

`/handoff` asks the current conversation for a brief (goal, current state, decisions, open tasks, key
files, next step), prints it in the chat as formatted text, and copies the raw markdown to the clipboard. Paste it into a new session to
continue there. The brief is a command output row, so the current session's model reads it too.

The **🛠** button opens a row above the bar with **Handoff**, **Subagents**, **Task View** and
**Clean View**, right-aligned; press it again to close the row without picking. **Handoff** writes the same brief into a **Handoff brief** pane, drawn as formatted text with
a **Copy** button; nothing is copied until you press it, and the brief stays out of the chat (so the current session's
model does not read it).

## Task View and Clean View

Two views from the **🛠** menu that turn Claude's work into a checklist under the bar (an open menu still shows
above it): done steps marked with a green ✓, the step in progress with a blue ●, steps not started with a dim ○.
In the menu a ● marks the view that is on and a ○ the one that is off; picking the one that is on turns it off, and
picking the other switches. The choice holds across sessions.

While one is on, its name shows in the status line under the prompt (with `Subagents` after a comma while the
Subagents pane is open with a team size picked). `/taskview` and `/cleanview` do the same as the
menu from the prompt: no argument toggles that view (turning it on switches off the other), `on` turns it on and `off`
turns it off.

```
Adding dark mode                                                    3 of 5
✓ Read the theme code                                   100% ▰▰▰▰▰▰▰▰▰▰
✓ Add the color tokens                                  100% ▰▰▰▰▰▰▰▰▰▰
● Wire up the toggle                                     40% ▰▰▰▰▱▱▱▱▱▱
○ Update tests                                            0% ▱▱▱▱▱▱▱▱▱▱
○ Run checks                                              0% ▱▱▱▱▱▱▱▱▱▱
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
once every step is done and Claude stops, it folds to one line, `✓ Done: <title> (<n> steps)`, with a **×** at its
right end that closes it. A quick question that
needs no work gets no checklist.

Clean View recognizes a final reply as the last thing Claude wrote before your next prompt. It reads them from the
conversation when the mod loads (so replies from before a reload or restart still show) and adds each new one as a
request finishes.

## Subagents

**Subagents** in the **🛠** menu opens the Subagents pane; the pane's own close mark closes it. `/subagents` opens it,
or closes it if open. It stays open until you close it, and comes back after the mod reloads.

While it is open, the pane lists every subagent Claude starts, one per line: Agent tool subagents (foreground or
background), and the agents of a workflow it starts, named after the workflow (`review-changes · agent 3`, since a
workflow's agents have no names of their own). Pieces waiting for a free helper sit on top, then the ones running
(oldest first), then the finished ones, the most recently finished first. Marks are Task View's: ○ queued, a blue ●
running, a ✓ done, and a red × failed. A running subagent's name is a lighter grey, followed in dim grey by what it is
doing from its latest tool call (`Reading bar.tsx`, `Running npm test`) and its running time. A finished line is all
dim (but a failed one's ×): no bar, just how long it ran and how long ago it finished, `0:09 (3m ago)`.

```
Showing: [All] Tool agents  Current task
Hide completed: [Never] 15m  5m  1m  Immediate
Set team size: Default  3 [5] 10  20  30
Set model: [Same as chat] Fast & cheap

5 agents · 3 working · 2 idle · 1 queued · 1 done
○ Check the zoning rules                                                    queued
● Research business licenses · Reading the city site               40% ▰▰▰▰▱▱▱▱▱▱  1:20
✓ Draft the floor plan                                                    0:56 (3m ago)
```

In each option row the choice in effect is drawn at full strength (shown as `[…]` above); the others are dim, and
pressing one picks it. They are the same compact buttons as the bar's.

**Set team size** starts on **Default**: subagents run as Claude Code normally runs them, and the pane only lists them (no
note, no model change, nothing in the status line). Pick a size and the team applies too, with `Subagents` in the
status line. While the pane is closed nothing is tracked; while it is open but not on screen (the status line then
reads `Subagents (not shown)`) the team does not apply.

- **Set team size**: how many helpers may run at once (3, 5, 10, 20 or 30). Past 10 the pane warns in yellow that a
  big team uses your Claude usage much faster.
- **Set model** (always shown; faint and unpickable on Default): **Same as chat** (the default) uses the chat's
  model and reasoning level; **Fast & cheap** runs every helper request on Sonnet 5.5 at low reasoning.
- With a size picked, each prompt carries a hidden note asking Claude to split a job with separate parts across the
  team, starting the pieces in parallel. Each helper's prompt asks it to report what it is doing and how far along it
  is through the mod's `agent_progress` tool (`mcp__aitools__agent_progress`): a helper's line shows its percent (its
  own estimate) and a bar, where other subagents show their latest tool call instead.
- A full team refuses further starts with a note to try again when a helper finishes (a hook may not hold a start for
  long); those pieces show as queued until they start.
- **Showing**: **All** (the default) lists every line; **Tool agents** leaves out workflow agents (only subagents
  Claude started with its Agent tool); **Current task** only those started since your last prompt.
- **Hide completed**: how long a finished line stays: **Never** (the default), **15m**, **5m**, **1m** or
  **Immediate**. Either way the pane keeps at most the newest 50 finished lines.
- The team, model, Showing and Hide completed picks are saved.
- A workflow's agents are told apart from the engine's own background forks (compaction, memory) only by whether a
  workflow has been started this session; after one, such a fork may briefly show as one of its agents.
- The pane itself starts closed in a new session.

## How thread cost % is estimated

The usage figures only report the weekly window as a percent, so the mod estimates what 1% of the week costs: this
machine's spend at API prices since the window opened (its reset time less 7 days) divided by the weekly percent used.
The thread's cost and the last turn's are then shown as shares of that, marked `~`. Usage on other machines or in
claude.ai's chat counts toward your weekly percent but not toward this machine's spend, which makes the shares read low;
the estimate also assumes the allowance is charged roughly in line with API prices. Hourly costs for the last 8 days are
kept alongside the monthly scan for this.

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
