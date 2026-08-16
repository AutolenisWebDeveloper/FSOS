#!/bin/bash
# claude-mem bootstrap for Claude Code on the web.
#
# Each web session runs in a fresh, ephemeral container where the claude-mem
# plugin runtime and its Observer worker are not present. This SessionStart
# hook installs the plugin runtime (Claude Code integration) and starts the
# Observer worker so persistent cross-session memory is available.
#
# Design notes:
#   - Remote-only: local machines install claude-mem once (it persists), so we
#     never touch a developer's local environment.
#   - Idempotent: `claude-mem install` / `start` are safe to re-run.
#   - Non-fatal: a claude-mem hiccup must never block the session from starting,
#     so every step is guarded and the hook always exits 0.
#   - Version-pinned for reproducibility; bump CLAUDE_MEM_VERSION to update.
set -uo pipefail

# Only run in Claude Code on the web (remote) sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

CLAUDE_MEM_VERSION="13.15.0"

# Install the plugin runtime + Claude Code integration, then start the Observer
# worker. Failures are logged to stderr but never abort session startup.
if ! npx --yes "claude-mem@${CLAUDE_MEM_VERSION}" install \
      --ide claude-code --no-auto-start >/dev/null 2>&1; then
  echo "claude-mem: install step failed (continuing without memory)" >&2
fi

if ! npx --yes "claude-mem@${CLAUDE_MEM_VERSION}" start >/dev/null 2>&1; then
  echo "claude-mem: worker (Observer) failed to start (continuing)" >&2
fi

exit 0
