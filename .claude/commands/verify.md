---
description: Run the FSOS verification gates and report the three-bucket result honestly.
argument-hint: [optional: what changed, to scope the targeted tests]
allowed-tools: Bash, Read, Grep, Glob
---

Verify the current working tree. Scope hint: **$ARGUMENTS**

Run the gates in **cheapest-first** order and stop at the first hard failure — fixing a type
error is pointless if a targeted test already disproves the change.

1. **Targeted tests** for what changed. Find them by name:
   `node scripts/run-tests.mjs --list | grep <topic>`, then run each directly:
   `node tests/<name>.test.mjs`
   If the change touches RLS, the securities firewall, the AI red line, consent, or quiet
   hours, the proof may live in the root-Postgres `rls` set, which does **not** run under
   `npm test`. Say so explicitly rather than implying the default suite covered it.

2. `npm run type-check`
3. `npm run lint`
4. `npm test`   (the `unit` set; continues past failures and reports all of them)
5. `npm run build`   — only when routes, components, or config changed.

**Do not run `npm run test:rls`** unless explicitly asked: it stands up a root-owned
Postgres. **Never** run a migration against a remote or production database.

Then report in exactly three buckets. Show real command output — never a summary of output
you did not read, and never a claim about a command you did not run.

**CODE-VERIFIED** — proven by tests / typecheck / lint / build, with the output shown.
**BROWSER-VERIFIED** — proven by actual browser interaction. Say which pages and which
interactions. If you did not open a browser, this bucket is empty; say so.
**NOT VERIFIED** — state plainly what was not verified and **why** (no live infrastructure,
requires production data, requires an authenticated write path, out of scope).

Finish with a one-line verdict: does this meet FSOS's definition of done, or not, and what is
the single next action. Remember that a green local run is **evidence for the owner's
decision, not the decision** — CI, branch protection, RLS, and owner approval are the real
control plane.
