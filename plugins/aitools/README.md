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

The **🛠** button opens a row above the bar with **Handoff**, **Notes**, **Subagents**, **Worktrees**, **Task View**
and **Clean View**, right-aligned; press it again to close the row without picking. **Handoff** writes the same brief into a **Handoff brief** pane, drawn as formatted text with
a **Copy** button; nothing is copied until you press it, and the brief stays out of the chat (so the current session's
model does not read it).

## Ask as choices

When Claude ends an answer with questions for you in plain text, `/askme` asks them again as pop-up questions
with clickable options. Claude's recommended option comes first, marked "(Recommended)", and each option says
what picking it means. Yes-or-no confirmations come four to a question, and you can always type your own answer
under "Other". Anything typed after the command is passed along as a note, as in `/askme only the M2 ones`.
After you answer, Claude sums up the decisions and carries on.

You don't have to type the command: when Claude's last answer asks you something and it hasn't already used the
pop-up for that request, a **?** button appears just left of **🛠** (`tools` in the terminal). It goes away once
you send your next prompt. Pressing it sends `/askme` straight away. If it can't, because Claude is still working
or the prompt was refused, it puts `/askme` in the prompt box for you to send. Anything you had typed there stays,
after the command, and goes along as its note. Only a question mark right after a word counts: a bare **?**, or one
inside code or a link, doesn't.

## Notes

**Notes** in the **🛠** menu opens a **Notes** pane with one text box for a single scratch note. It is kept in
`.claude/notes.md` under the project root, a plain Markdown file you can open anywhere else too, and saved as you
type. **Copy**, at the end of the line above the box, copies the note to the clipboard. Add `.claude/notes.md` to the
project's `.gitignore` if it should stay out of git.

Click in the box to type. Enter starts a new line, the arrows, Home and End move the cursor (Ctrl+A and Ctrl+E too),
Page Up and Page Down move ten rows, and Backspace and Delete remove. Escape hands the keys back to the prompt. There
is no selection or undo. Pasting works in the terminal but not in the desktop app, where a mod cannot read the
clipboard; paste into `.claude/notes.md` in another editor and reopen the pane instead. The pane stays open until you close it, and comes back after the mod reloads.
Where a surface cannot draw the box (VS Code, the mobile app), the pane says where the note is kept instead.

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
✓ Read the theme code                                       100% ▰▰▰▰▰▰
✓ Add the color tokens                                      100% ▰▰▰▰▰▰
● Wire up the toggle                                         40% ▰▰▱▱▱▱
○ Update tests                                                0% ▱▱▱▱▱▱
○ Run checks                                                  0% ▱▱▱▱▱▱
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

On the desktop, Clawd stands left of the pane's option rows with a mini Clawd stacked on his head for each subagent
running in the list (the stack stops growing at four), and sleeps in quiet grey when none is. The status line under the options
sits beside him too. The terminal has no picture.

While it is open, the pane lists every subagent Claude starts, one per line: Agent tool subagents (foreground or
background), and the agents of a workflow it starts, named after the workflow (`review-changes · agent 3`, since a
workflow's agents have no names of their own). The ones running come first (oldest first), then the finished ones, the
most recently finished first; pieces waiting for a free helper get no line, only a count in the header. Marks are Task
View's: a blue ● running, a ✓ done, and a red × failed. A running subagent's name is a lighter grey, followed in dim grey by what it is
doing from its latest tool call (`Reading bar.tsx`, `Running npm test`) and its running time. A line's name and
what it is doing take at most 65 characters together, cut with `…`. A finished line is all
dim (but a failed one's ×): no bar, just how long it ran and how long ago it finished, `0:09 (3m ago)`.

```
Showing: [All] Tool agents  Current task
Hide completed: [Never] 15m  5m  1m  Immediate
Set team size: Default  3 [5] 8  10  20
Set model: [Same as chat] Fast & cheap

5 agents · 3 working · 2 idle · 1 queued · 1 done
● Research business licenses · Reading the city site                   40% ▰▰▱▱▱▱  1:20
✓ Draft the floor plan                                                    0:56 (3m ago)
```

In each option row the choice in effect is drawn at full strength (shown as `[…]` above); the others are dim, and
pressing one picks it. They are the same compact buttons as the bar's.

**Set team size** starts on **Default**: subagents run as Claude Code normally runs them, and the pane lists them (no
team note, no model change, nothing in the status line); each is only asked to report its progress. Pick a size and the team applies too, with `Subagents` in the
status line. While the pane is closed nothing is tracked; while it is open but not on screen (the status line then
reads `Subagents (not shown)`) the team does not apply.

- **Set team size**: how many helpers may run at once (3, 5, 8, 10 or 20). Past 10 the pane warns in yellow that a
  big team uses your Claude usage much faster.
- **Set model** (always shown; faint and unpickable on Default): **Same as chat** (the default) uses the chat's
  model and reasoning level; **Fast & cheap** runs every helper request on Sonnet 5.5 at low reasoning.
- With a size picked, each prompt carries a hidden note asking Claude to split a job with separate parts across the
  team, starting the pieces in parallel.
- Every subagent Claude starts with its Agent tool while the pane is open (a team helper or not) has its prompt ask it
  to report how far along it is through the mod's `agent_progress` tool (`mcp__aitools__agent_progress`); once it
  does, its line shows its percent (its own estimate) and a bar. A helper's line shows what it says it is doing;
  other subagents' lines follow their latest tool call. Workflow agents, and subagents started before the pane opened,
  are not asked, so they show no bar.
- A full team refuses further starts with a note to try again when a helper finishes (a hook may not hold a start for
  long); the header counts those pieces as queued until they start.
- **Showing**: **All** (the default) lists every line; **Tool agents** leaves out workflow agents (only subagents
  Claude started with its Agent tool); **Current task** only those started since your last prompt. With nothing to
  list, the pane says what will appear there, e.g. `Tool subagents will appear here when created.`
- **Hide completed**: how long a finished line stays: **Never** (the default), **15m**, **5m**, **1m** or
  **Immediate**. Either way the pane keeps at most the newest 50 finished lines.
- The team, model, Showing and Hide completed picks are saved.
- A workflow's agents are told apart from the engine's own background forks (compaction, memory) only by whether a
  workflow has been started this session; after one, such a fork may briefly show as one of its agents.
- The pane itself starts closed in a new session.

## Worktrees

**Worktrees** in the **🛠** menu opens the Worktrees pane; the pane's own close mark closes it. `/worktrees` opens it,
or closes it if open. It stays open until you close it, and comes back after the mod reloads.

On the desktop, Clawd stands left of the pane's header, snipping a stray branch off a tree. He sweeps with a broom
while worktrees are being removed, and naps under the tree, he and it in grey, when the project has no worktrees
besides the main checkout. The terminal has no picture.

```
4 worktrees · 2 to clean · 1 with changes · 1 unpushed
Clean removes 2 merged worktrees with their local and remote branches. 2 worktrees with changes, unmerged commits or in use stay.

Clean worktrees

● main · 2 changed files · main checkout · this session        5h    +34  −11  –
● feat/worktrees-pane · 3 changed files · PR #1               12m   +612  −48  ●  ×
○ challenge-view-display-fields · merged · PR #168             6h     +0   −0  ✓  ×
↑ feat/totem-sizes · 2 unpushed commits                        2d    +96 −210  ×  ×
```

The header counts the worktrees besides the main checkout, then the ones Clean would remove, the ones with changes and
the ones with unpushed commits. Under it, a line says what **Clean worktrees** would do, or what the last removal did.

Each row is one worktree: the main checkout always first, then the one this session runs in, then the rest by last
commit.

- **The mark**: a blue ● the worktree this session is in, a yellow ● uncommitted changes, a yellow ↑ commits not
  pushed, ○ anything else.
- **The name**: its branch, or its folder for a detached worktree (the desktop app makes those). After it, in dim
  grey, what it holds that Clean would keep (changed files, unpushed or unmerged commits), or `merged`, then its pull
  request and what it is (`main checkout`, `this session`, `detached`, `locked`, `folder missing`). The name and
  these words take at most 50 characters together, the most telling words first; a merged worktree's name is dim too.
- **On the right**, in columns that line up on every row: how long since its last commit (`12m`, `5h`, `2d`), lines
  added and removed since it left the base branch (uncommitted work included), CI, and ×.
- **CI**: ✓ passed, × failed, ● still running, – none found. It is its pull request's checks at its commit, else the
  GitHub Actions runs at its commit.
- **×** asks on a line under the row, `Delete feat/x and its branch?` with **Yes** and **No**, and says what would be
  lost (`This loses 3 uncommitted files and 2 unpushed commits.`). A merged worktree's remote branch is deleted too; an
  unmerged one's is kept, since it may hold the only copy of its commits. Pressing × again takes the question back.
  The main checkout, the worktree this session is in and locked worktrees have no ×.

**Clean worktrees** asks `Remove 2 worktrees and their branches?` with **Yes** and **No**, then removes each worktree
that has nothing uncommitted (untracked files included) and nothing unmerged, with its local branch and its remote
branch. It is faint and does nothing when no worktree qualifies.

- A worktree counts as merged when the base branch has all its commits, or its pull request merged at its current
  commit (a squash merge). A detached worktree's pull request is found by its commit.
- The base branch is origin's default branch (`origin/main`), else `origin/main` or `origin/master`, else a local
  `main` or `master`.
- The main checkout, the worktree this session is in and locked worktrees are never removed. The rows are read again
  just before removing, and git itself refuses a worktree with changes, since Clean never forces.
- Git never prompts: a push that needs a password fails, and the pane says so.
- A worktree with no commits and no changes of its own counts as merged, so Clean removes it, even one another session
  has just made and not touched yet.

The pane only reads git while it is open: when it opens, every 10 seconds, and a moment after a tool that can change
files (Bash, Edit, Write, a subagent). GitHub (pull requests and CI, through the `gh` command) is read when it opens
and every minute. Without `gh`, or signed out, CI shows – and the rest works. Closed, it reads nothing.

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
