#!/usr/bin/env bash
# Validate, type-check and test every mod under plugins/.
set -euo pipefail
cd "$(dirname "$0")/.."

for dir in plugins/*/; do
  echo "== validate $dir"
  claude plugin validate "$dir"
done

if [ ! -f .claude/types/claude-code.d.ts ]; then
  echo "run /plugin-types in a Claude Code session first (writes .claude/types/)" >&2
  exit 1
fi
echo "== tsc"
npx -y -p typescript@5 tsc --noEmit -p .

for dir in plugins/*/; do
  if compgen -G "${dir}test/*.test.ts*" > /dev/null; then
    echo "== test $dir"
    claude plugin test "$dir"
  fi
done
