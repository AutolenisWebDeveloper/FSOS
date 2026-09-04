# CLAUDE.md — FSOS Engineering Contract

<!-- Durable facts and binding rules only. Procedures live in docs/ and .claude/skills/.
     The hard rules here are ENFORCED by .claude/settings.json, .claude/hooks/, and CI —
     not by this file. Keep it under ~200 lines: adherence drops as it grows.
     NOTE: ~68 source files cite section NUMBERS from an older revision ("CLAUDE.md §6",
     "§4.3", ...). Those numbers no longer resolve. Headings here are named, not numbered:
     read the cited comment for intent, and this file for the current rule. -->

## What this repo is

Next.js 15 (App Router) + TypeScript (strict) + Supabase (Postgres, RLS) + Vercel.
FSOS is the operating system for a Farmers Financial Services Agent in McKinney, TX who
partners with Farmers agency owners in a B2B2C model. The spine is:

`Agency Partnership → Referral → Household → Review → Opportunity → Case → Commission`

Product identity: `PRODUCT.md`. Design system: `DESIGN.md`. Rationale: `docs/adr/`.

Improve the existing product. Do not turn it into a generic CRM, and do not build a second
system for something FSOS already owns.

## Commands (use these exactly; do not guess)

| Purpose | Command |
|---|---|
| Unit tests (all) | `npm test` → `node scripts/run-tests.mjs unit` |
| One test | `node tests/<name>.test.mjs` — but `.mts` needs `npx tsx tests/<name>.test.mts` |
| List what will run | `node scripts/run-tests.mjs --list` (add `rls` for the other set) |
| RLS tests — root Postgres; **only when asked** | `npm run test:rls` |
| Typecheck | `npm run type-check` → `tsc --noEmit` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| E2E (Playwright) | `npm run test:e2e` |

Tests are a **custom harness, not a framework**: bare `.mjs`/`.mts` scripts under `tests/`,
auto-discovered by `scripts/run-tests.mjs`, asserting with `node:assert/strict`; several shell
out to `npx tsc`. Do NOT introduce a test framework and do NOT use `describe`/`it` or
`node:test`. The runner continues past failures so one run surfaces all of them.
`tests/expected-failures.json` pins deliberately-red files: an unpinned failure fails the run,
and **a pinned file that passes also fails the run** — delete its entry in the commit that
legitimately turns it green. It is currently empty.

Three ways a green run can be lying to you:
- **Discovery is one level deep.** `readdirSync('tests')` — no recursion. A test placed in a
  `tests/` subdirectory, or beside its source as `*.test.ts`, is never discovered and the
  suite still reports green. Top-level `tests/*.mjs|.mts` only; confirm with `--list`.
- **`npm test` is not everything.** It runs the `unit` set and deliberately excludes the RLS
  set. Mode comes from the first positional arg, so `npm test -- rls` silently runs *unit*.
- **`npm run test:rls` skips cleanly without Postgres.** Only `CI_REQUIRE_INFRA=1` (which CI
  sets) turns a missing toolchain into a failure instead of a green no-op.

## Architecture invariants (do not violate)

- Mutating routes parse the body with `readJson()` (`src/lib/http.ts`) and feed the result to
  a Zod schema. The schema import is indirect, so do NOT measure validation coverage by
  grepping for `from 'zod'` — look for `.safeParse()`/`.parse()` on the `readJson` result.
  `req.formData()` uploads are outside this path by design.
- All model calls go through `runGateway()` (`src/lib/ai/gateway.ts:275`) — kill switch,
  provider fallback, cost telemetry. Importing `getAnthropic` outside `gateway.ts` and
  `src/lib/anthropic.ts` is a bypass; `tests/ai-gateway-seam.test.mjs` fails CI on it.
- Reach Supabase through `getDb()` (`src/lib/supabase/client.ts:34`) or `getBrowserDb()`
  (`:64`). Never construct a module-level client.
- **Know which boundary protects you.** `getDb()` is the **service-role** client and
  **bypasses RLS by design** (167 of 260 API routes use it). On a server route the boundary
  is therefore the application layer — `requireApiRole(portal)` (`src/lib/auth/api.ts:33`,
  used by 206 routes), which enforces session, role, and MFA/step-up. Never assume RLS is
  protecting a route that calls `getDb()`; authorize explicitly.
- **RLS is still the boundary** for `getBrowserDb()` (anon key) and for anything reaching
  Postgres directly, and it is the last line of defence behind every route. Keep policies
  correct; never weaken one to make a query work.
- Domain and workflow logic lives in `src/lib/services/*`. Routes stay thin:
  parse → authenticate/authorize → validate → call service → typed response.
- All outbound messaging goes through the dispatcher (`src/lib/comms/dispatcher.ts:98`) and
  the ordered compliance gate `evaluateGate()` (`src/lib/comms/gate.ts:252`), whose ~20
  enumerated steps are the consent/quiet-hours/DNC/suppression/red-line checks. Never add a
  second send path and never bypass a gate step.
- New comms work targets the `comm_campaigns` / `comm_sequences` engine, not the legacy drip
  system.

## Investigation before implementation

Before writing code:

1. Restate the objective in one sentence.
2. Trace the request end-to-end (route → `readJson` validation → handler → service → data
   model/RLS → tests) and name the exact files and functions involved.
3. Produce an **evidence table** for the material claims.
4. State what you will reuse vs. create, and what must be preserved.

Evidence, proportional to consequence. Cite `file:line` for architecture conclusions,
security/authorization boundaries, database and RLS behavior, API contracts, workflow behavior,
functionality being changed, and any assertion justifying a decision. Narration needs none.

A Supabase claim sourced from a migration file is an **assumption** about the live database,
not a verified fact, unless the live project was actually queried.

The governing rule: **no material implementation decision may rest on an unverified assumption
about this repository.** "I have not verified that" is a correct answer; guessing is not.

## Resolving ambiguity (do not over-ask)

Resolve low-risk ambiguity yourself from repository evidence and existing conventions — state
the assumption and proceed. Stop and ask only when the ambiguity materially changes business
behavior, security/compliance, data integrity, architecture, or scope, or when the action is
irreversible.

## Reuse before create

**REUSE → EXTEND → CONSOLIDATE → CREATE ONLY WHAT IS MISSING.** Before adding a service,
component, table, column, endpoint, job, or dependency, find the nearest existing example and
match it. FSOS has one design system, auth model, data-access path, communications path,
campaign engine, AI gateway, appointment system, and audit trail. No speculative infrastructure.

## Compliance boundaries (non-negotiable)

**Securities.** FSOS may track operational metadata that a securities opportunity or case
exists — stage, referring agency, commission fields, a non-substantive reference to the
FFS-supervised system. FSOS is **not** the system of record: never store securities account
numbers, order/transaction details, or suitability determinations
(`src/lib/compliance/firewall.ts:71`). `is_security` applies to that opportunity, case, or
communication — **not** automatically to every interaction with the contact (`:77`). Automated
securities messages are withheld from the campaign engine and routed to the licensed FSA. This
boundary must never block unrelated CRM activity, appointment, administrative, or service
messages.

**The AI red line.** AI may identify opportunities, educate generally, invite, schedule,
remind, follow up, support consented campaigns, summarize, and draft internal material. AI must
**never** independently make an individualized product, policy, investment, replacement, or
allocation recommendation, or a suitability or best-interest determination
(`src/lib/compliance/guardrail.ts:108`; `GREEN_ZONE_ACTIONS`/`RED_LINE_ACTIONS` at `:14`) —
those escalate to the licensed FSA. AI client-facing messages must pass the existing validation
and dispatch path; the validator judges that message in context, and must not broadly disable
unrelated communications for the whole contact.

**Assumptions are labeled, never asserted.** Planning inputs such as term-conversion windows
and carrier rules are config defaults carrying `is_assumption = true`, surfaced as "verify" —
never presented as published Farmers/FFS figures.

**Audit.** Important operations write through `writeAudit()` (`src/lib/audit/log.ts:75`) to the
append-only audit log. Never suppress an audit write to make a flow succeed.

## Outbound messaging and A2P SMS

Applies to automated or bulk SMS campaigns. It does **not** govern email, CRM, frontend,
reporting, case management, documents, analytics, or unrelated FSOS work — do not generalize it
into restrictions elsewhere.

- Send only through the existing FSOS/Twilio path, on the configured A2P brand, campaign, and
  number.
- Verify the recorded SMS consent that campaign requires. **Absence of an opt-out is not
  consent.**
- Identify the sender/business in the first campaign message. Include the registered campaign's
  opt-out language, without duplicating it when already present.
- Support `STOP` and `HELP`; suppress further campaign SMS immediately on opt-out.
- Apply DNC suppression, frequency caps, and the quiet-hours window. Quiet hours are
  **recipient-local via a resolved IANA timezone** (caller-supplied, else NPA/ZIP) — they are
  NOT state-aware; do not describe them as such. A timezone that cannot be resolved is itself
  a hard block (`timezone_unresolved`, `src/lib/comms/gate.ts:290`). The 9:00 a.m.–8:00 p.m.
  window is FSOS's operating floor for SMS marketing, not a universal legal rule.
- **Fail closed** when consent, sender configuration, approved template, or message content
  cannot be resolved: log the block, send nothing partial or blank, never silently switch
  channel.
- Audit every campaign-SMS attempt — blocked or sent — with actor, recipient, campaign/message,
  timestamp, consent basis, and outcome. Record send, delivery, failure, reply, and opt-out in
  the existing communications history.
- Before production campaign traffic: verify `STOP`, `HELP`, suppression, status callbacks, and
  an end-to-end test send.

## Protected paths & forbidden actions

Also enforced by `.claude/settings.json` and `.claude/hooks/block-danger.sh`, which deny these
regardless of what this file says.

- **Never edit an existing file in `supabase/migrations/`** — it may already be applied. Add a
  NEW migration. (Creating a new one is expected; the hook blocks only edits to files that
  already exist.)
- Never read or write `.env*` secrets. `.env.local.example` is committed and safe to edit.
- Never hand-edit `package-lock.json` — run the npm command that regenerates it. (Email/SMS
  template *sources* under `src/emails/` and `src/lib/booking/sms-templates.ts` ARE
  hand-edited; their build output is approved database rows, not checked-in files.)
- Never run recursive force deletes, `git reset --hard`, force pushes, `git clean -fd`,
  `drop database`, `truncate table`, or `supabase db push|reset|link`.
- **Never run a migration against production. Never commit or push without approval.**

## Verification cadence (do not pay full cost on every edit)

- **During implementation:** edit freely. A `PostToolUse` hook only records that TypeScript
  changed.
- **At a checkpoint:** targeted tests for what you changed, then typecheck — `/verify`.
- **At the end:** the relevant suite, lint, build, browser verification where legitimate, then
  adversarial review in a fresh context — `/review`.

The `Stop` hook runs the project typecheck once, and only if TypeScript was touched. It blocks
at most once per batch of edits, so it cannot trap a session.

## Definition of done (all true AND evidenced)

- The business requirement is satisfied end-to-end — not merely "code written" or "tests pass".
- `npm run type-check` clean, `npm run lint` clean, relevant tests pass — **show the output**.
- No capability silently removed; no out-of-scope changes; unrelated user edits preserved.
- No debug code, secrets, dead code, fake production data, or placeholders left in scope.
- Verification reported in three buckets.

## Three-bucket verification (report honestly; never fabricate)

- **CODE-VERIFIED** — proven by tests/typecheck/lint/build, with output shown.
- **BROWSER-VERIFIED** — proven by actual browser interaction.
- **NOT VERIFIED** — state plainly what was not verified and **why**.

Never claim a command was run, a test passed, or a file was inspected unless it actually was.

## Control plane — you are not the final authority

You can inspect, test, review, and produce evidence. You do not decide whether you succeeded.
CI (`.github/workflows/ci.yml`: type-check → lint → test → build → `test:rls`), branch
protection, database constraints, RLS, and owner approval are the real controls. Never describe
work as shipped, safe, or approved on the strength of your own review.

## Frontend

Every surface reads as one premium financial-services platform: `DESIGN.md`, the existing
tokens, shared components, and archetype layouts (`docs/archetypes.md`). Deliver every state
(loading, empty, error, success, validation), responsive behavior, accessible semantics and
contrast, and confirmation for destructive actions. Server-first, narrow client boundaries. No
fake controls, dead-end pages, or decorative metrics. Review the **rendered** page, not the source.

## Skills, commands, MCP

Discover skills from `.claude/skills/` at task start and load the smallest relevant set — do
not rely on a hard-coded list. Commands: `/investigate` (read-only evidence table), `/verify`
(gates + three-bucket report), `/review` (adversarial review via the `implementation-reviewer`
subagent), `/prompt-for-claude-code` (fills `docs/claude/implementation-prompt-template.md`).

MCP servers in `.mcp.json`: supabase, twilio, graphify, playwright. Prefer a CLI tool where it
is cheaper than an MCP round-trip.

## References (load only when the task needs them)

`PRODUCT.md` · `DESIGN.md` · `docs/adr/` · `docs/routes.md` · `docs/sitemap.md` ·
`docs/specs/rbac-matrix.md` · `docs/archetypes.md` · `docs/claude/` (prompt templates) ·
`docs/PROMPTS.md` (original phase build pack) · `.claude/skills/`

Treat repository behavior as evidence, documentation as context, and the current authorized
request as the outcome to deliver.
