#!/bin/bash
# PostToolUse — record that TypeScript changed, so the Stop gate knows whether a
# typecheck is worth paying for.
#
# WHY A MARKER INSTEAD OF RUNNING tsc HERE: `tsc --noEmit` on FSOS takes tens of seconds.
# Paying that after every edit costs minutes per task and buys nothing, because the Stop
# gate runs it once at the end anyway and cannot be skipped.
#
# The marker lives in $TMPDIR keyed by a hash of the project path — nothing is written
# into the repo, so no .gitignore entry is needed and parallel worktrees do not collide.
set -uo pipefail

payload="$(cat 2>/dev/null || true)"

if command -v jq >/dev/null 2>&1; then
  path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
else
  # No jq: assume every edit is a TypeScript edit. The gate still runs; it just runs
  # more often than strictly necessary. Degrade toward MORE checking, never less.
  path="unknown.ts"
fi

case "$path" in
  *.ts|*.tsx|*.mts|*.cts) ;;
  *) exit 0 ;;
esac

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
key="$(printf '%s' "$proj" | cksum | cut -d' ' -f1)"
marker="${TMPDIR:-/tmp}/fsos-claude-ts-dirty-${key}"

# The marker path is derivable (a cksum of the project dir) and, with TMPDIR unset, lands in
# world-writable /tmp. `>>` follows symlinks, so anyone able to pre-create that name as a
# symlink could have this hook append to a file of their choosing. Refuse to follow one, and
# keep the marker private to its owner.
if [ -L "$marker" ]; then
  rm -f "$marker" 2>/dev/null || exit 0
fi
if [ ! -e "$marker" ]; then
  (umask 077; : > "$marker") 2>/dev/null || exit 0
fi
[ -f "$marker" ] && [ ! -L "$marker" ] || exit 0
printf '%s\n' "$path" >> "$marker" 2>/dev/null || true
exit 0
