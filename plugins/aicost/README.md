# aicost

A one-row bar above the prompt showing how close your Claude subscription is to its limits, and what the work would
cost at Anthropic API list prices.

```
5h 42% ·1h12m │ wk 18% ·Thu │ ctx 31% 62k/200k │ cache 42m │ thread $3.12 (+$0.41) │ month $184.20 │ limit ~3:40pm   [Handoff] [Settings]
```

| Segment | Meaning |
|---|---|
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

## Settings

Press **Settings** to open the checklist and toggle any of: 5-hour usage, weekly usage, reset countdowns, context %, context
tokens, cache warmth, thread cost, last-turn cost, monthly cost, burn-rate projection, threshold colors, threshold alerts, Handoff
button. Choices are saved across sessions. Press **Done** to close it.

Threshold alerts are one-time toasts when the 5-hour or weekly window passes 90%, and when context passes 80%.

## Handoff

**Handoff** (or `/handoff`) asks the current conversation for a brief (goal, current state, decisions, open tasks, key
files, next step), saves it to `.claude/handoffs/YYYY-MM-DD-HHMM.md` in the project, and copies it to the clipboard.
Paste it into a new session to continue there.

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
