---
description: Fill the FSOS implementation-prompt template against this repo for a given goal.
argument-hint: <what you want built>
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(rg:*), Bash(ls:*), Bash(find:*), Bash(sed:*)
---

Author a complete, ready-to-paste implementation prompt for: **$ARGUMENTS**

The template and a worked example are imported below. Use the template's section order
verbatim.

@docs/claude/implementation-prompt-template.md

@docs/claude/implementation-prompt-example-sms-optout.md

**How to fill it.** This is a research task before it is a writing task. Do NOT write the
prompt from general knowledge of the stack — inspect this repository first and fill each
section with real file paths, real table names, real function names, and the real test
harness. The worked example above is the density to aim for: note how it names the trace
(`route → readJson() → handler → service → consent model → tests`), and how it tells the
implementer what to **verify rather than assume**.

Rules:

- **Never delete a section to avoid filling it.** Write `N/A — <reason>`. A silently missing
  section is the single biggest cause of Claude Code building the wrong thing.
- Cite real paths. If you are unsure whether something exists, say "verify whether X exists"
  rather than asserting it does — a confident wrong path sends the implementer down a dead end.
- Name what must be **preserved**, not only what must be built.
- Enumerate edge cases concretely (idempotency, retries, duplicates, malformed input, partial
  failure), each with its expected handling.
- State authorization limits explicitly: what may be done autonomously, and what requires
  stopping to ask. Migrations against production, commits, pushes, merges, and deploys are
  never autonomous.
- Map tests to FSOS's actual harness: bare `.mjs` scripts under `tests/` using
  `node:assert/strict`, auto-discovered by `scripts/run-tests.mjs`. No framework, no
  `describe`/`it`. Say whether the test belongs in the `unit` set or the root-Postgres `rls`
  set.

Output the filled prompt in a single fenced block so it can be copied in one action. Then, in
a short note **outside** the block, list the assumptions you made and anything you could not
determine from the repository.

> Related but different: `docs/PROMPTS.md` is the original phase-by-phase build pack
> (Foundation → P0 → P3). This command is for a single change to an existing system.
