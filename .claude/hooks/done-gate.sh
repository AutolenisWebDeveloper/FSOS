#!/bin/bash
# Stop hook — run the project typecheck once at the end of a turn, and only if TypeScript was
# actually touched (post-edit.sh sets the marker).
#
# LOOP SAFETY — read this before changing anything.
# A Stop hook that exits 2 prevents Claude from stopping. If it can block on every re-entry the
# session never ends. The documented `stop_hook_active` guard is NOT present in the Stop payload
# on current CLI versions, so this hook does not depend on it: the DIRTY MARKER is the guard.
# The marker is removed at the moment we decide the outcome, so a block requires a fresh edit
# and cannot repeat. (`stop_hook_active` is still honored if a future CLI supplies it.)
#
# ORDER MATTERS: the marker is consumed AFTER the typecheck returns, not before. An earlier
# version claimed it up front, which meant a hook cancelled at its `timeout` — the CLI discards
# a timed-out hook — destroyed the marker and silently skipped the typecheck for good. Now a
# killed run leaves the marker in place and the next Stop re-checks.
#
# Contract: exit 2 = prevent stopping (stderr is fed back to Claude); exit 0 = allow.
set -uo pipefail

payload="$(cat 2>/dev/null || true)"

if command -v jq >/dev/null 2>&1 && [ -n "$payload" ]; then
  active="$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
  [ "$active" = "true" ] && exit 0
fi

proj="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$proj" 2>/dev/null || exit 0

key="$(printf '%s' "$proj" | cksum | cut -d' ' -f1)"
marker="${TMPDIR:-/tmp}/fsos-claude-ts-dirty-${key}"

# No TypeScript touched this turn -> nothing to pay for. Refuse a symlink: the path is
# derivable and lands in world-writable /tmp when TMPDIR is unset, so a pre-seeded symlink
# could otherwise drive this gate off a file the session does not own.
if [ -L "$marker" ]; then
  rm -f "$marker" 2>/dev/null
  exit 0
fi
[ -f "$marker" ] || exit 0

# Cannot typecheck without dependencies installed — do not block, and keep the marker so the
# check still happens once someone installs them.
[ -d "$proj/node_modules/typescript" ] || exit 0

# Finish inside the hook's own timeout (settings.json allows 300s) so we control the outcome
# rather than being cancelled mid-run.
if command -v timeout >/dev/null 2>&1; then
  out="$(timeout 240 npx --no-install tsc --noEmit 2>&1)"; status=$?
else
  out="$(npx --no-install tsc --noEmit 2>&1)"; status=$?
fi

# 124 = our own timeout fired. Leave the marker so the next Stop retries; do not block on it.
if [ $status -eq 124 ]; then
  echo "done-gate: typecheck exceeded 240s and was stopped; not blocking. Run 'npm run type-check' yourself." >&2
  exit 0
fi

# Decision made — consume the marker now. From here a repeat block is impossible without a
# fresh edit, which is the loop guard.
rm -f "$marker" 2>/dev/null

[ $status -eq 0 ] && exit 0

{
  echo "TYPECHECK FAILED — 'npm run type-check' is not clean, so this turn is not done."
  echo "CLAUDE.md: a clean typecheck is part of the definition of done."
  echo
  errs="$(printf '%s\n' "$out" | grep -E "error TS" | head -40)"
  if [ -n "$errs" ]; then
    printf '%s\n' "$errs"
  else
    # tsc failed for a non-type reason (crash, OOM, broken install, npx failure). Show the
    # real output — an earlier version printed nothing here and blocked with no explanation.
    echo "tsc exited $status with no 'error TS' lines — this is a toolchain failure, not a type error:"
    printf '%s\n' "$out" | tail -25
  fi
  echo
  echo "Fix these, then finish. (This gate blocks at most once per batch of edits;"
  echo "it re-arms only when TypeScript is edited again.)"
} >&2

exit 2
