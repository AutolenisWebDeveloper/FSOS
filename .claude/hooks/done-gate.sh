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

# ORPHAN CONTROL. The CLI cancels a hook that reaches its timeout, and a cancelled or
# SIGKILLed shell takes no traps with it — so a naively-spawned `tsc` is reparented to init
# and keeps burning CPU until its own timeout fires. Two defences:
#   1. `set -m` puts the child in its own process group, and the EXIT trap kills the GROUP,
#      which covers every signal that can actually be trapped.
#   2. SIGKILL cannot be trapped, so each run also reaps the previous run's orphan via a
#      pidfile. The pid is only killed if its cmdline still looks like ours — a recycled pid
#      must never be a casualty.
pidfile="${TMPDIR:-/tmp}/fsos-claude-ts-gate-${key}.pid"

if [ -f "$pidfile" ]; then
  stale="$(cat "$pidfile" 2>/dev/null)"
  case "$stale" in
    ''|*[!0-9]*) ;;
    *)
      if kill -0 "$stale" 2>/dev/null &&
         tr '\0' ' ' < "/proc/$stale/cmdline" 2>/dev/null | grep -q 'tsc'; then
        kill -TERM -"$stale" 2>/dev/null || kill -TERM "$stale" 2>/dev/null
      fi ;;
  esac
  rm -f "$pidfile" 2>/dev/null
fi

# A SIGKILLed run cannot run its trap, so it also leaves its capture file behind. Sweep this
# project's strays older than 10 minutes. A per-file loop, not `find -delete`: a bulk delete
# is exactly what block-danger.sh forbids, and the hooks should hold to the same rule.
for stray in "${TMPDIR:-/tmp}"/fsos-claude-ts-out-*; do
  [ -f "$stray" ] || continue
  [ -n "$(find "$stray" -maxdepth 0 -mmin +10 2>/dev/null)" ] && rm -f "$stray" 2>/dev/null
done

#   3. A watchdog inside the job polls whether this hook is still alive and kills the
#      typecheck if it is not. SIGKILL leaves no trap to run, so without this the last
#      orphan idles until its own 240s timeout; the watchdog bounds that to ~1s.
HOOK_PID=$$
set -m                      # each background job gets its own process group
tmpout="${TMPDIR:-/tmp}/fsos-claude-ts-out-$$"
(
  if command -v timeout >/dev/null 2>&1; then
    timeout 240 npx --no-install tsc --noEmit > "$tmpout" 2>&1 &
  else
    npx --no-install tsc --noEmit > "$tmpout" 2>&1 &
  fi
  inner=$!
  while kill -0 "$inner" 2>/dev/null; do
    if ! kill -0 "$HOOK_PID" 2>/dev/null; then
      kill -TERM "$inner" 2>/dev/null
      sleep 1
      kill -KILL "$inner" 2>/dev/null
      exit 143
    fi
    sleep 1
  done
  wait "$inner" 2>/dev/null
  exit $?
) &
child=$!
printf '%s\n' "$child" > "$pidfile" 2>/dev/null
trap 'kill -TERM -"$child" 2>/dev/null; rm -f "$pidfile" "$tmpout" 2>/dev/null' EXIT INT TERM HUP
wait "$child" 2>/dev/null; status=$?
set +m
out="$(cat "$tmpout" 2>/dev/null)"
rm -f "$tmpout" "$pidfile" 2>/dev/null

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
