# Master Implementation Prompt for Claude Code

Copy this, fill every section. If a section is genuinely N/A, write `N/A — <reason>`.
**A section left blank is the #1 cause of Claude Code misunderstanding the objective.**

Used two ways:
- In Claude Code: `/prompt-for-claude-code <goal>` loads this file and fills it against the repo.
- In Claude Chat: add this file to the Architecture Project's knowledge, then ask for the
  implementation prompt — you get a filled template rather than a paragraph.

---

## Objective & business outcome
[What must be true for the business/users after this ships. Outcome, not task list.]

## Non-goals / out of scope
[Explicitly excluded. This is what prevents scope creep.]

## Existing functionality that MUST be preserved
[Named capabilities that must not regress.]

## Files/modules to inspect FIRST (investigate before coding)
[Known entry points. Instruct: trace end-to-end, cite `file:line`, build an evidence table
BEFORE writing code. Name anything that must be verified rather than assumed.]

## Architecture constraints & invariants
[e.g. request bodies parsed with `readJson()` from `src/lib/http.ts` then validated with Zod;
AI calls through the gateway seam (`src/lib/ai/gateway.ts`); RLS is the security boundary;
target the `comm_campaigns` / `comm_sequences` engine, not the legacy drip system.]

## Data-model implications
[New migration? Backfill? RLS policy changes? Index impact? **Never edit an existing
migration** — add a new one.]

## Integration points
[Routes, services, external APIs, Supabase, Twilio, Resend, jobs/schedulers.]

## Edge cases & failure modes
[Enumerate them and specify the expected handling for each. Include retries,
duplicates/idempotency, malformed input, and partial failure.]

## Security / authorization boundaries
[Who may do what; tenant/RLS scoping; input trust boundaries; signature verification;
PII in logs.]

## UI/UX requirements
[States: loading / empty / error / success. Responsive behavior. Accessibility.
Destructive-action confirmation. Which existing design system components to reuse.]

## Test requirements (mapped to the repo's actual harness)
[Name the specific cases. FSOS has **no test framework**: bare `.mjs` scripts under `tests/`
asserting with `node:assert/strict`, auto-discovered by `scripts/run-tests.mjs`. No
`describe`/`it`, no `node:test`. State whether the test belongs in the `unit` set or the
root-Postgres `rls` set.]

## Verification steps (incl. browser where legitimate)
[`npm run type-check`; `npm run lint`; `npm run build`; `npm run test`. Browser verification
via Playwright MCP — state read-only vs authenticated explicitly, and what is off-limits.]

## Acceptance criteria
[Objective pass/fail checklist. Someone else should be able to score it.]

## Out of scope
[Restate the hard boundary.]

## Authorization limits
[What may be done autonomously vs what requires stopping and asking. Migrations against
production, commits, pushes, merges, deploys.]

## Required completion report format
[Three-bucket verification (CODE-VERIFIED / BROWSER-VERIFIED / NOT VERIFIED) with output
shown; evidence table (claim → `file:line`); files changed and why; explicit statement of any
capability delta.]
