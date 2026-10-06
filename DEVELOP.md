# Developing claude-mods

To install from a local checkout instead of GitHub:

```
/plugin marketplace add ~/Projects/claude-mods
/plugin install aitools@claude-mods
```

Or load mods straight from this checkout, with hot reload, by adding to the `env` block of `~/.claude/settings.json`
(paths separated by `:`; restart Claude Desktop after changing it):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/Projects/claude-mods/plugins/aitools",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

Check everything (manifest validation, type-check, tests) before committing:

```bash
scripts/validate.sh
```

The type-check reads the plugin API declarations from `.claude/types/` (git-ignored). Run `/plugin-types` in a
Claude Code session to write or refresh them after a Claude Code update.

## Layout

```
.claude-plugin/marketplace.json   every mod, listed for /plugin
docs/images/                      README mockups
plugins/<mod>/
  .claude-plugin/plugin.json      manifest
  hooks/hooks.json                points at the hooks module
  hooks/register.tsx              event wiring
  src/                            the mod's units
  test/                           claude plugin test
  types/index.d.ts                the mod's $.state contract
scripts/validate.sh               validate + tsc + tests for every mod
tsconfig.json                     shared type-check config
```

## Adding a mod

1. Create `plugins/<name>/` with the files above.
2. Add `{ "name": "<name>", "source": "./plugins/<name>", "description": "…" }` to `.claude-plugin/marketplace.json`.
3. Run `scripts/validate.sh`.
