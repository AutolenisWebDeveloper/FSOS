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

# RUNNING THE TYPECHECK WITHOUT ORPHANING IT.
#
# A Stop hook can die three ways: SIGKILL (untrappable), a trappable signal (SIGTERM/SIGHUP on
# cancellation or teardown), or a kill of its whole process group. A naively-spawned `tsc` then
# survives, reparented to init, burning CPU for minutes.
#
# ONE mechanism handles all three: a watchdog subshell that owns the typecheck for its whole
# life and tears it down the moment it notices this hook is gone. An earlier version stacked
# three defences instead and they broke each other — the EXIT trap's group-kill killed the
# WATCHDOG rather than the typecheck (GNU `timeout` calls setpgid on itself, so the typecheck
# is never in the group the trap targeted), which removed the only thing that could clean up.
# So: nothing here kills the watchdog. `set -m` gives it its OWN process group precisely so a
# group-kill aimed at this hook cannot take it down with us.
#
# The pidfile "reap the previous run's orphan" layer is gone on purpose. It recorded the
# watchdog's pid (cmdline `bash done-gate.sh`), so its `grep tsc` identity check could never
# match its own target — and that same substring matches `tsconfig.json` on any argv, so it
# could SIGTERM an innocent `next dev` or `vitest --watch`. A layer that cannot do its job but
# can kill your dev server is worse than no layer.
tmpout="${TMPDIR:-/tmp}/fsos-claude-ts-out-$$"
[ -L "$tmpout" ] && rm -f "$tmpout" 2>/dev/null
: > "$tmpout" 2>/dev/null || exit 0        # cannot capture output -> never block blindly

HOOK_PID=$$
set -m                                     # watchdog gets its own process group
(
  if command -v timeout >/dev/null 2>&1; then
    timeout 240 npx --no-install tsc --noEmit > "$tmpout" 2>&1 &
  else
    npx --no-install tsc --noEmit > "$tmpout" 2>&1 &
  fi
  inner=$!
  # Signal BY PID, never by process group. Measured: `kill -TERM -$inner` delivers the signal
  # to this watchdog as well — it is in that group — so the watchdog killed itself partway
  # through the teardown and left the typecheck orphaned, the exact failure it exists to
  # prevent. `kill $inner` reaches `timeout`, which forwards to the command it manages;
  # `pkill -P` mops up the direct child for the no-`timeout` fallback branch, which also has
  # no cap of its own — hence the tick budget below (960 * 0.25s = 240s).
  # Liveness of the hook is decided by OUR OWN PARENT PID, not by `kill -0 $HOOK_PID`.
  # A terminated-but-unreaped parent is a ZOMBIE, and a zombie still answers `kill -0` — so
  # the old check stayed "alive" for as long as whoever spawned the hook took to reap it, and
  # the typecheck ran on unsupervised. Whether that window exists depends on whether the
  # launcher forked, which made the failure look intermittent. A dead parent, zombie or not,
  # reparents its children immediately, so PPID flips the instant the hook exits.
  # NOTE: capture BASHPID here, NOT inside the command substitutions below. Inside `$( )`
  # BASHPID is the substitution subshell's own pid, so reading /proc/$BASHPID/stat there
  # returns THAT process's ppid — i.e. the watchdog — which never equals HOOK_PID. The check
  # then fires on the first tick, the typecheck is killed immediately, and the gate silently
  # stops typechecking anything while every orphan test still passes.
  WD_PID=$BASHPID
  parent_gone() {
    local pp=""
    if [ -r "/proc/$WD_PID/stat" ]; then
      # Skip past "comm", which may itself contain spaces or parens; then field 2 is ppid.
      pp=$(sed 's/.*) //' "/proc/$WD_PID/stat" 2>/dev/null | cut -d' ' -f2)
    else
      pp=$(ps -o ppid= -p "$WD_PID" 2>/dev/null | tr -d ' ')
    fi
    [ -n "$pp" ] && [ "$pp" != "$HOOK_PID" ] && return 0
    kill -0 "$HOOK_PID" 2>/dev/null || return 0
    return 1
  }

  ticks=0
  while kill -0 "$inner" 2>/dev/null; do
    if parent_gone || [ "$ticks" -ge 960 ]; then
      kill -TERM "$inner" 2>/dev/null
      pkill -TERM -P "$inner" 2>/dev/null
      sleep 1
      kill -KILL "$inner" 2>/dev/null
      pkill -KILL -P "$inner" 2>/dev/null
      exit 143
    fi
    sleep 0.25
    ticks=$((ticks + 1))
  done
  wait "$inner" 2>/dev/null
  exit $?
) &
child=$!

# Leave without touching the watchdog, and WITHOUT falling through to the block logic below.
# The earlier version's handler had no `exit`, so after a trapped signal the script resumed,
# read status 143 as a typecheck result, deleted the marker and emitted a fabricated
# "TYPECHECK FAILED" — it disarmed itself and lied about why.
trap 'exec 2>/dev/null; rm -f "$tmpout" 2>/dev/null; exit 0' INT TERM HUP

wait "$child" 2>/dev/null; status=$?
out="$(cat "$tmpout" 2>/dev/null)"
rm -f "$tmpout" 2>/dev/null

# Sweep this project's strays from a previous SIGKILLed run (a per-file loop, not
# `find -delete`: a bulk delete is what block-danger.sh forbids and the hooks hold to it too).
for stray in "${TMPDIR:-/tmp}"/fsos-claude-ts-out-*; do
  [ -f "$stray" ] || continue
  [ -n "$(find "$stray" -maxdepth 0 -mmin +10 2>/dev/null)" ] && rm -f "$stray" 2>/dev/null
done

# 124 = the typecheck hit its own cap. >=128 = it was signalled, i.e. this run was cancelled.
# Neither is a type error: do not block, and LEAVE the marker so the next Stop re-checks.
if [ "$status" -eq 124 ] || [ "$status" -ge 128 ]; then
  echo "done-gate: typecheck did not finish (status $status); not blocking, will re-check on the next Stop." >&2
  exit 0
fi

# Consume the marker — this, and only this, is the loop guard. If it cannot be removed, do NOT
# block: an unremovable marker would make EVERY future Stop block forever with no way out,
# which is far worse than one missed typecheck.
rm -f "$marker" 2>/dev/null
if [ -e "$marker" ]; then
  echo "done-gate: could not clear $marker, so a block could not be cleared either; allowing the stop." >&2
  exit 0
fi

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
