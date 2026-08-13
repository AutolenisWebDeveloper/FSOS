# ADR-038 — District Agent Financial Services Nurture Campaign ("The Second Conversation")

**Status:** Accepted
**Date:** 2026-08-13
**Owner:** FSOS Engineering

## Context

The three existing multi-channel campaign engines — Life Conversion (ADR-029), Cross-Sell
Life (ADR-032), and Pipeline Win-Back (ADR-031) — are all **client-facing**: they enroll
household members / policies / opportunities and speak to the end consumer. FSOS has no
capability that treats the **Farmers agency owner / district agent as the audience**.

"The Second Conversation" is a **12-month, agent-facing educational nurture** that runs
alongside the FSA's B2B2C model (`Agency Partnership → Referral → Household → … → Commission`).
Its objective is not to sell the agent anything — it is to **teach the district agent to
recognize when a client's situation calls for a licensed Financial Services conversation, and
to make a clean warm hand-off to Markist Athelus** (the licensed FS Agent who works *alongside*
the Farmers agent — never the client's P&C agent).

The requirements source (task brief; the referenced `FSOS_12_Month_District_Agent_Nurture_Campaign.md`
is not present in the repository — see §Assumptions) defines:

- **12 connected Financial Services education modules** (a strict sequential curriculum).
- **24 professionally designed HTML emails** (2 per module).
- **12 A2P-configured SMS messages** (1 per module).
- **4 quarterly live touchpoints** (human, never auto-dispatched).
- Enrollment, scheduling, preview/approval, delivery, replies, meeting/referral hand-offs,
  pause/resume/suppression/exit, analytics, and launch-readiness — **all inside FSOS**.

The reuse-first rule (CLAUDE.md §6) binds: one dispatcher, one gate, one consent model, one
state machine, one audit log, one analytics contract. We extend, we do not clone.

## Decision

Build **`district_nurture`** as a dedicated module that **mirrors the Life Conversion campaign
shape onto the agency spine** and reuses every enforcement layer.

### 1. Audience = agency owners, not clients
- **Population view `v_district_nurture_candidates`** (`security_invoker = on`) joins
  `agency_partnerships` + `agency_owners` (+ the reconciled `contacts` row for phone/email),
  filtered to reachable, non-terminated agencies. No `is_security` firewall population exists on
  the agency directory (mig 051), but the firewall assertion is preserved for symmetry and the
  send path re-derives it server-side regardless.
- **`district_nurture_enrollments`** is keyed to `agency_id` + `agency_owner_id`
  (`unique (campaign_id, agency_owner_id)`) — **not** `member_id`/`household_id`. This is the one
  structural departure from the client engines and the reason a new schema is justified.

### 2. Consent for an agent recipient
Agents are **contact-resolvable but not household members**, so the member-keyed `consents`
table cannot hold them. Consent is captured as **`comm_contact_consents`** rows keyed by the
agent's normalized phone/email — exactly the durable-contact-consent path `sendThroughGate()`
already reads when `memberId` is null. The tick passes `memberId: null` and `to: <agent contact>`;
STOP/opt-out is enforced through `dnc_entries` on every send. The campaign uses a distinct
message **purpose** so agent educational consent is never conflated with client consent.

### 3. Reuse, don't duplicate (CLAUDE.md §6)
The module-agnostic pure primitives — the **campaign/enrollment state machine** (`states.ts`),
**advisor-touch policy** (`advisor.ts`), **conversation timeout/owner** logic (`conversation.ts`),
**no-catch-up resume** (`resume.ts`), and **retry backoff** (`retry.ts`) — are imported verbatim
from `@/lib/life-campaign/*` through a documented `district-nurture/engine.ts` barrel (the same
seam ADR-031 established). Only the self-contained `schedule.ts` / `eligibility.ts` are
re-implemented (the isolated-compile tests require self-contained files).

### 4. All sends stay on the existing rails
Every send routes through `sendThroughGate()` (message-content, consent, quiet-hours 9am–8pm
recipient-local, DNC, approved-template, personalization, recommendation red-line, securities
firewall, A2P hold). Content lands as `approval_status = 'draft'` `comm_templates`
(category `district_nurture`) and **cannot dispatch until a human approves it** (ADR-023). Sends
attribute via `campaignId: null` + `sourceKind: 'campaign_asset'` + `sourceCampaignKey:
'district_nurture'` + `entity: { type: 'district_nurture_enrollment', id }` (the F-1 message-of-record
contract). Audit is the append-only `audit_log` via `writeAudit()`. The engine is mirrored into
`comm_campaigns` as an inert registry row by the same trigger pattern as migration 109.

### 5. Sequential curriculum vs. calendar overlays (explicit reconciliation)
The 12-module curriculum is a **strict learning progression** and runs **sequentially relative to
each enrollment's baseline** — module *N* fires in campaign-month *N*, never reordered by calendar.
Genuinely seasonal initiatives (Life Insurance Awareness Month in September, tax-season money-in-
motion in Q1) are modeled as **calendar-aware overlays**: a pure `CALENDAR_OVERLAYS` data set
surfaced in the UI and realized as **scheduled activation tasks**, not as a mutation of the touch
order. This preserves the curriculum while honoring the seasonal intent (task brief).

### 6. Live touchpoints = advisor_outreach
The 4 quarterly live touchpoints are `advisor_outreach` touches (touch kind reused from the shared
model). They are **human tasks** — a `work_tasks` row + a tracked `district_nurture_advisor_touches`
row; nothing is auto-dispatched, and a missed live touch never stalls the timeline (§9a policy,
reused from `advisor.ts`).

### 7. Education boundary (content contract)
Every message teaches the agent: what a concept/product does, what need it addresses, the client
statement that signals an opportunity, the limitations/costs/risks, **what the agent may say**,
**what requires the licensed FSA**, and **how to make the introduction**. No body trains an
unlicensed agent to recommend securities, compare products, determine suitability, recommend
allocations/rollovers/replacements, or interpret illustrations/prospectuses. Enforced
recommendation-free by `tests/district-nurture-messaging.test.mjs` against the real
`containsRecommendationLanguage`, and by the gate's recommendation step at send time.

## Consequences

- A fourth campaign-shaped schema exists, isolated to `district_nurture_*` tables, justified by the
  agent-keyed audience. It reuses the dispatcher, gate, consent, state machine, resume/retry,
  analytics contract, presentation vocabulary, and UI component kit unchanged.
- The engine is agent-facing and must remain **separate** from the three client campaigns while
  sharing infrastructure — it appears as its own campaign in the Campaign Center.
- Agent-side consent lives in `comm_contact_consents`; a future agent-owner-keyed consent store
  could replace it, but the contact-resolvable model is correct today.

## Rollback

Drop the `district_nurture_*` migrations (content then schema), remove `district-nurture-tick` /
`-retry` from `src/jobs/index.ts` + `vercel.json`, delete `src/lib/district-nurture/*`,
`/api/district-nurture/*`, and `/app/comms/district-nurture`, and remove the `district_nurture`
entry from `CAMPAIGN_ENGINES` + the nav registries. No shared or life-campaign code changes to revert.

## Assumptions

- The referenced `FSOS_12_Month_District_Agent_Nurture_Campaign.md` is **absent from the repo**;
  the task brief is used verbatim as the authoritative business-requirements and content source.
- Baseline = enrollment date; monthly cadence ≈ 30 days; campaign length = 365 days / 40 touches
  (24 email + 12 SMS + 4 live). Send instant is the shared `T13:00:00.000Z` mid-day UTC anchor;
  recipient-local quiet hours are enforced by the gate.
