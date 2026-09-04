#!/bin/bash
# Stop hook — run the project typecheck once at the end of a turn, and only if
# TypeScript was actually touched (post-edit.sh sets the marker).
#
# LOOP SAFETY — read this before changing anything:
# A Stop hook that exits 2 prevents Claude from stopping. If it can block on every
# re-entry, the session never ends. The documented `stop_hook_active` guard is NOT
# present in the Stop payload on current CLI versions, so this hook does not depend
# on it. Instead the DIRTY MARKER ITSELF is the guard: the marker is consumed (moved
# aside) BEFORE the typecheck runs, so a second Stop with no intervening edit finds no
# marker and exits 0 immediately. Blocking therefore requires a fresh edit each time,
# which is exactly the loop we want (fix -> edit -> re-check) and cannot run away.
# `stop_hook_active` is still honored if a future CLI version supplies it.
#
# Contract (verified against the Claude Code hooks reference):
#   - exit 2  => prevent stopping; stderr is fed back to Claude
#   - exit 0  => allow stopping
set -uo pipefail

payload="$(cat 2>/dev/null || true)"

# Belt and braces: if the runtime ever does supply stop_hook_active, respect it.
if command -v jq >/dev/null 2>&1 && [ -n "$payload" ]; then
  active="$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
  [ "$active" = "true" ] && exit 0
fi

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$proj" 2>/dev/null || exit 0

key="$(printf '%s' "$proj" | cksum | cut -d' ' -f1)"
marker="${TMPDIR:-/tmp}/fsos-claude-ts-dirty-${key}"

# No TypeScript touched this turn -> nothing to pay for.
[ -f "$marker" ] || exit 0

# CONSUME the marker before doing any work. Everything after this point is
# guaranteed to happen at most once per edit batch.
claimed="${marker}.claimed.$$"
mv "$marker" "$claimed" 2>/dev/null || exit 0
trap 'rm -f "$claimed"' EXIT

# Cannot typecheck without dependencies installed — do not block on that.
[ -d "$proj/node_modules/typescript" ] || exit 0

out="$(cd "$proj" && npx --no-install tsc --noEmit 2>&1)"
status=$?

[ $status -eq 0 ] && exit 0

{
  echo "TYPECHECK FAILED — \`npm run type-check\` is not clean, so this turn is not done."
  echo "CLAUDE.md: 'npx tsc --noEmit clean' is part of the definition of done."
  echo
  printf '%s\n' "$out" | grep -E "error TS" | head -40
  echo
  echo "Fix these, then finish. (This gate blocks at most once per batch of edits;"
  echo "it re-arms only when TypeScript is edited again.)"
} >&2

exit 2
