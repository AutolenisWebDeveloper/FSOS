#!/bin/bash
# PreToolUse guard — deterministic block for destructive / protected-path actions.
#
# WHY THIS EXISTS: CLAUDE.md's "never do X" lines are prose, and prose can be ignored. This
# hook and the `permissions.deny` block in .claude/settings.json are the parts that cannot be.
#
# DESIGN — why this is not a substring scan.
# v1 matched forbidden text anywhere in the command line. That is wrong in both directions:
#   - it MISSED `git -C dir reset --hard`, `rm -Rf`, `rm --recursive --force`, `find . -delete`
#     (the forbidden text was not adjacent, or was spelled differently), and
#   - it BLOCKED `grep -rn "rm -rf" docs/`, `git commit -m "fix rm -rf"`, `cat .env.example`
#     (the text appeared, but as data, not as the thing being run).
# A guard that blocks real work gets switched off, and one with known holes is worse than none
# because you rely on it. So this version splits the line into subcommands and inspects the
# EXECUTABLE TOKEN and its flags. `grep` is never dangerous no matter what it is grepping for;
# `rm` with a recursive flag always is, however it is spelled.
#
# FAILURE POSTURE: fail OPEN on an internal error, CLOSED on a positive match. The declarative
# deny rules in settings.json remain in force either way.
#
# Contract (verified against the Claude Code hooks reference):
#   stdin: JSON with .tool_name and .tool_input   |   exit 2 = block (stderr is the reason)
set -uo pipefail

payload="$(cat 2>/dev/null || true)"
[ -z "$payload" ] && exit 0

# Field extraction. jq when available; otherwise a targeted scan of the flat JSON fields —
# v1's fallback left `tool` empty, which silently disabled EVERY Edit/Write rule.
json_str() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r "$1 // empty" 2>/dev/null
  else
    printf '%s' "$payload" \
      | tr -d '\n' \
      | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"(\\\\.|[^\"\\\\])*\"" \
      | head -1 | sed -E "s/^\"$2\"[[:space:]]*:[[:space:]]*\"//; s/\"$//" \
      | sed -E 's/\\"/"/g; s/\\\\/\\/g'
  fi
}
tool="$(json_str '.tool_name' 'tool_name')"
cmd="$(json_str  '.tool_input.command' 'command')"
path="$(json_str '.tool_input.file_path' 'file_path')"

deny() {
  echo "BLOCKED by .claude/hooks/block-danger.sh: $1" >&2
  echo "This is a hard rule in CLAUDE.md (Protected paths & forbidden actions)." >&2
  echo "If you genuinely need this, stop and ask the repository owner." >&2
  exit 2
}

# A heredoc BODY is data written to a file, never executed — a doc that names a forbidden
# command must not trip the guard. Only `<<TAG` / `<<-TAG` open one; `<<<` is a herestring and
# must NOT be treated as an opener (v1 did, and silently dropped the rest of the command,
# which could HIDE a real destructive command on a later line).
strip_heredoc_bodies() {
  awk '
    BEGIN { intag = "" }
    {
      if (intag != "") {
        l = $0; sub(/^[ \t]+/, "", l)
        if (l == intag) intag = ""
        next
      }
      # Find a heredoc opener at a COMMAND position: `<<` that is not inside quotes, not in a
      # comment, and not the `<<<` herestring operator. Matching `<<` anywhere on the line
      # (the previous approach) let a literal `<<` inside a quoted string or a comment set a
      # bogus terminator, which blanked every following line before scanning — a destructive
      # command on line 2 then sailed through. On any ambiguity we do NOT strip: over-scanning
      # can only over-block, while under-scanning misses a real command.
      line = $0; n = length(line); sq = 0; dq = 0; i = 1
      while (i <= n) {
        ch = substr(line, i, 1)
        if (ch == "\\" && !sq) { i += 2; continue }
        if (ch == "\047" && !dq) { sq = !sq; i++; continue }
        if (ch == "\"" && !sq)   { dq = !dq; i++; continue }
        if (!sq && !dq && ch == "#" && (i == 1 || substr(line, i-1, 1) ~ /[ \t]/)) break
        if (!sq && !dq && ch == "<" && substr(line, i+1, 1) == "<") {
          if (substr(line, i+2, 1) == "<") { i += 3; continue }   # herestring
          rest = substr(line, i+2)
          sub(/^-/, "", rest)
          sub(/^[ \t]+/, "", rest)
          if (match(rest, /^[\047"]?[A-Za-z_][A-Za-z0-9_]*[\047"]?/)) {
            t = substr(rest, RSTART, RLENGTH); gsub(/[\047"]/, "", t); intag = t
          }
          break
        }
        i++
      }
      print
    }
  ' 2>/dev/null
}

# ---------------- Bash: analyse each subcommand's executable token ----------------
if [ "$tool" = "Bash" ] || { [ -z "$tool" ] && [ -n "$cmd" ]; }; then
  scan="$(printf '%s' "$cmd" | strip_heredoc_bodies)"
  [ -z "$scan" ] && scan="$cmd"

  # Split on shell separators so each piece has its own executable in first position.
  subcmds="$(printf '%s' "$scan" | sed -E 's/\|\||&&|;|\||\&|\n/\n/g')"

  analyze() {
    # Default IFS for the whole body: argv word-splitting needs it, and so does "$*" — with
    # IFS=newline the joined args come back newline-separated and every " --flag " test fails.
    local IFS=$' \t\n'
    # shellcheck disable=SC2086
    set -- $1                                   # word-split; quoted text becomes later words,
    while [ $# -gt 0 ]; do                      # never the executable in position 1
      case "$1" in
        *=*) shift ;;                           # leading env assignment: FOO=bar cmd
        command|builtin|exec|nohup|time|sudo|env) shift ;;
        *) break ;;
      esac
    done
    [ $# -eq 0 ] && return 0
    exe="${1##*/}"; exe="$(printf '%s' "$exe" | tr -d "\"'")"; shift
    args="$*"

    case "$exe" in
      bash|sh|zsh|dash)                          # recurse into `bash -c "..."`
        # The quoted script was split into words above. Skip only the shell's OWN leading
        # options, then take everything from the first non-flag word onward as the script —
        # filtering all `-*` would eat the inner command's flags (`bash -c "rm -rf x"` would
        # arrive as `rm x` and look harmless).
        while [ $# -gt 0 ]; do
          case "$1" in -*) shift ;; *) break ;; esac
        done
        [ $# -gt 0 ] && analyze "$*"
        return 0 ;;
      xargs) analyze "$args"; return 0 ;;

      # Package runners. `supabase` is not on PATH and is not a project dependency, so
      # `npx supabase db push` is the ONLY realistic way to invoke it — without this arm the
      # supabase rule below never fires and the protection is dead in practice.
      npx|bunx|pnpx)
        while [ $# -gt 0 ]; do
          case "$1" in
            -p|--package|--call|--node-options) shift 2 ;;
            -*) shift ;;
            *) break ;;
          esac
        done
        [ $# -gt 0 ] && analyze "$*"
        return 0 ;;
      pnpm|yarn|bun)
        # Only the "run an arbitrary package" subcommands; `pnpm install` is not a runner.
        case "${1:-}" in
          dlx|exec|x) shift; [ $# -gt 0 ] && analyze "$*" ;;
        esac
        return 0 ;;

      rm)
        for a in "$@"; do
          case "$a" in
            --recursive|--dir) deny "recursive delete (rm $a)" ;;
            --*) ;;
            -*) case "$a" in *[rR]*) deny "recursive delete (rm $a)" ;; esac ;;
          esac
        done ;;

      find)
        case " $args " in
          *" -delete "*|*" -delete") deny "find -delete (bulk delete)" ;;
        esac
        case "$args" in *"-exec rm"*|*"-execdir rm"*) deny "find -exec rm (bulk delete)" ;; esac ;;

      git)
        # Skip git's own global options to reach the real subcommand: `git -C dir reset --hard`
        while [ $# -gt 0 ]; do
          case "$1" in
            -C|-c|--git-dir|--work-tree|--namespace|--exec-path) shift 2 ;;
            --git-dir=*|--work-tree=*|--exec-path=*|--namespace=*|-P|--no-pager|--paginate|--bare) shift ;;
            *) break ;;
          esac
        done
        sub="${1:-}"; [ $# -gt 0 ] && shift
        rest=" $* "
        case "$sub" in
          reset)  case "$rest" in *" --hard "*) deny "git reset --hard (discards committed and uncommitted work)" ;; esac ;;
          push)   case "$rest" in
                    *" --force "*|*" -f "*|*" --force-with-lease "*|*" --force-with-lease="*|*" --force-if-includes "*)
                      deny "force push (rewrites published history)" ;;
                  esac ;;
          clean)  # -n / --dry-run makes it safe; -f (or --force) without it deletes.
                  case "$rest" in *" -n"*|*" --dry-run "*) : ;;
                    *) case "$rest" in *" --force "*) deny "git clean --force (deletes untracked files)" ;; esac
                       for a in "$@"; do case "$a" in --*) ;; -*[fdx]*) deny "git clean $a (deletes untracked files)" ;; esac; done ;;
                  esac ;;
          checkout|restore)
                  case "$rest" in *" -- "*|*" --worktree "*) deny "git $sub -- <path> (discards uncommitted changes)" ;; esac ;;
          stash)  case "$rest" in *" clear "*|*" drop "*) deny "git stash $sub (destroys stashed work)" ;; esac ;;
          filter-branch) deny "git filter-branch (rewrites history)" ;;
          branch) case "$rest" in *" -D "*) deny "git branch -D (force-deletes a branch)" ;; esac ;;
        esac ;;

      supabase)
        case " $args " in
          *" db push"*|*" db reset"*|*" link "*|*" link")
            deny "supabase $args — schema changes against a remote project are owner-run only" ;;
        esac ;;

      psql|mysql|mariadb|pg_dump|dropdb|dropuser|cockroach)
        [ "$exe" = "dropdb" ] && deny "dropdb"
        case "$(printf '%s' "$args" | tr 'A-Z' 'a-z')" in
          *"drop database"*|*"drop schema"*|*"truncate table"*|*"drop table"*)
            deny "destructive SQL ($exe)" ;;
        esac ;;

      # Reading a secret file into the transcript. *.example / *.sample / *.template are
      # committed, carry no secrets, and are legitimately read.
      cat|less|more|head|tail|bat|od|xxd|strings|nl)
        for a in "$@"; do
          case "$a" in
            *.example|*.sample|*.template) ;;
            .env|.env.*|*/.env|*/.env.*) deny "reading a .env file (secrets must never enter the transcript)" ;;
          esac
        done ;;
    esac
    return 0
  }

  # An array, not `while read` (a pipe would put the body in a subshell and swallow deny's
  # exit 2) and not an IFS-split word loop (the body would inherit the mutated IFS).
  mapfile -t _subs < <(printf '%s\n' "$subcmds")
  for sc in "${_subs[@]}"; do
    [ -n "${sc// /}" ] && analyze "$sc"
  done
fi

# ---------------- File writes ----------------
if [ "$tool" = "Edit" ] || [ "$tool" = "Write" ] || [ "$tool" = "NotebookEdit" ]; then
  case "$path" in
    *.example|*.sample|*.template) ;;
    *"/.env"|*"/.env."*|".env"|".env."*) deny "writing a .env file" ;;
  esac
  # A committed migration may already be applied; editing it diverges deployed schema from
  # the repo. Adding a NEW migration is expected and stays allowed.
  case "$path" in
    *"supabase/migrations/"*)
      [ -f "$path" ] && deny "editing an existing migration in supabase/migrations/ — add a NEW migration instead" ;;
  esac
  case "$path" in
    *"package-lock.json") deny "hand-editing package-lock.json — run the npm command that regenerates it" ;;
  esac
fi

exit 0
