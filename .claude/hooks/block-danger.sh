#!/bin/bash
# PreToolUse guard — deterministic block for destructive / protected-path actions.
#
# WHY THIS EXISTS: CLAUDE.md's "never do X" lines are prose, and prose can be ignored.
# This hook and the `permissions.deny` block in .claude/settings.json are the parts that
# cannot be. settings.json deny rules are the PRIMARY layer (evaluated by the CLI itself);
# this hook is the second net for shapes a static pattern misses — a destructive command
# buried mid-pipeline, inside `bash -c`, or behind an env-var prefix.
#
# FAILURE POSTURE: fail OPEN on any internal error (unreadable stdin, no jq, bad JSON) and
# fail CLOSED only on a positive match. A safety hook that hard-fails on malformed input
# would block all work; the declarative deny rules remain in force either way.
#
# Contract (verified against the Claude Code hooks reference):
#   - stdin: JSON with .tool_name and .tool_input
#   - exit 2  => BLOCK the tool call; stderr is shown to Claude as the reason
#   - exit 0  => allow
set -uo pipefail

payload="$(cat 2>/dev/null || true)"
[ -z "$payload" ] && exit 0

if command -v jq >/dev/null 2>&1; then
  tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  cmd="$(printf '%s' "$payload"  | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
  path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
else
  # Degraded mode: no jq. Scan the raw payload so the guard still bites.
  tool=""; cmd="$payload"; path="$payload"
fi

deny() {
  echo "BLOCKED by .claude/hooks/block-danger.sh: $1" >&2
  echo "This is a hard rule in CLAUDE.md (Protected paths & forbidden actions)." >&2
  echo "If you genuinely need this, stop and ask the repository owner." >&2
  exit 2
}

# Strip heredoc BODIES before scanning. A heredoc body is data written to a file, never
# executed — so a doc or config that merely NAMES a forbidden command (this repo's own
# CLAUDE.md lists them) must not trip the guard. Everything else, `bash -c "..."` included,
# is still scanned.
strip_heredoc_bodies() {
  awk '
    BEGIN { intag = "" }
    {
      if (intag != "") {
        l = $0; sub(/^[ \t]+/, "", l)
        if (l == intag) intag = ""
        next
      }
      if (match($0, /<<-?[ \t]*[\047"]?[A-Za-z_][A-Za-z0-9_]*[\047"]?/)) {
        t = substr($0, RSTART, RLENGTH)
        sub(/^<<-?[ \t]*/, "", t)
        gsub(/[\047"]/, "", t)
        intag = t
      }
      print
    }
  ' 2>/dev/null
}

# ---------- Bash commands ----------
if [ -z "$tool" ] || [ "$tool" = "Bash" ]; then
  # Normalize: collapse whitespace so `rm    -rf` and `rm\t-rf` match alike.
  scan="$(printf '%s' "$cmd" | strip_heredoc_bodies)"
  [ -z "$scan" ] && scan="$cmd"
  norm="$(printf '%s' "$scan" | tr '\n\t' '  ' | tr -s ' ')"

  case "$norm" in
    *"rm -rf"*|*"rm -fr"*|*"rm -r -f"*|*"rm -f -r"*)
      deny "recursive force delete (rm -rf)" ;;
  esac
  case "$norm" in
    *"git push"*"--force"*|*"git push"*" -f "*|*"git push -f")
      deny "force push (git push --force)" ;;
  esac
  case "$norm" in
    *"git reset --hard"*)
      deny "git reset --hard (discards uncommitted work)" ;;
  esac
  # Only the destructive flag cluster attached to `git clean` itself. A shell glob like
  # *"git clean -"*d*f* matches any later d and f ANYWHERE in the command, which blocked
  # `git clean -n` (a dry run) whenever the line happened to contain a d and an f.
  if printf '%s' "$norm" | grep -qE 'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*[fdx]'; then
    deny "git clean with -f/-d/-x (deletes untracked files; -n dry run is allowed)"
  fi
  case "$norm" in
    *"drop database"*|*"DROP DATABASE"*|*"drop schema"*|*"DROP SCHEMA"*)
      deny "DROP DATABASE / DROP SCHEMA" ;;
  esac
  case "$norm" in
    *"truncate table"*|*"TRUNCATE TABLE"*)
      deny "TRUNCATE TABLE" ;;
  esac
  # Never run a migration against a remote/production database from a Claude session.
  case "$norm" in
    *"supabase db push"*|*"supabase db reset"*|*"supabase link"*)
      deny "supabase db push/reset/link — migrations against a remote project are owner-run only" ;;
  esac
  # Reading secrets into the transcript.
  case "$norm" in
    *"cat .env"*|*"cat ./.env"*|*"less .env"*|*"head .env"*|*"tail .env"*|*"cat "*"/.env"*)
      deny "reading a .env file (secrets must never enter the transcript)" ;;
  esac
fi

# ---------- File writes ----------
if [ "$tool" = "Edit" ] || [ "$tool" = "Write" ] || [ "$tool" = "NotebookEdit" ]; then
  # Real secret files only. `.env.local.example` is committed, carries no secrets, and
  # is legitimately edited when a new variable is introduced — do not block it.
  case "$path" in
    *.example|*.sample|*.template) ;;
    *"/.env"|*"/.env."*|".env"|".env."*)
      deny "writing a .env file" ;;
  esac
  # A migration that has been committed may already be applied somewhere. Editing it
  # silently diverges deployed schema from the repo. Add a NEW migration instead.
  case "$path" in
    *"supabase/migrations/"*)
      if [ -f "$path" ]; then
        deny "editing an existing migration in supabase/migrations/ — add a NEW migration instead" ;
      fi ;;
  esac
  # Generated artifacts: edit the generator, not the output.
  case "$path" in
    *"src/lib/comms/templates/generated"*|*"/generated/"*|*".generated."*)
      deny "editing a generated file — change the generator and re-run it" ;;
  esac
  case "$path" in
    *"package-lock.json")
      deny "hand-editing package-lock.json — run the npm command that regenerates it" ;;
  esac
fi

exit 0
