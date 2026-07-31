# ADR-031 — Pipeline Win-Back Campaign (stalled internal-opportunity re-engagement)

**Status:** Accepted
**Date:** 2026-07-31
**Owner:** FSOS Engineering (owner-confirmed checkpoints, 2026-07-31)

## Context

The Win-Back Life Campaign spec (§4) defines "win-back" eligibility as **internal
FSOS pipeline drop-off** — leads who entered the pipeline (quoted, applied, went
cold, or were lost) and never converted. This collides, by name only, with an
already-built concept: `src/lib/opportunities/winback.ts`
(`WIN_BACK_SOURCE = 'win_back'`, `planWinbackOpportunities`) plus the
`/app/winback` import/origination surface, which turns an **imported list of
former life clients** (`contacts.source = 'winback_life'`, tag `life-winback`)
into pipeline opportunities. These are **two different populations that share the
word "win-back"** (spec §0.1).

Separately, the sibling **Life Conversion Campaign** (ADR-029, migrations 081/082,
`src/lib/life-campaign/*`) already ships a first-class, single-per-contact,
**multi-channel** timeline layered on the native comms engine, with operational
controls (§4b), advisor-touch tracking (§9a), conversation pause/resume, and a
per-touch idempotent scheduler. Its architecture is the correct template for this
module (spec §0.5).

## Owner-confirmed checkpoints (spec §0.7)

Both open checkpoints were resolved by the campaign owner on 2026-07-31 (recorded
here per §0.7 / final-validation checklist — not silently assumed):

1. **Campaign length — 120 days / 24 touches.** Build the exact §7 schedule
   (8 email, 8 SMS, 6 AI conversation, 2 advisor outreach), with the drafted
   Day 125–140 tail compressed into Days 90–120. Not 140 days.

2. **Population & coexistence — separate modules, shared infrastructure.**
   - The existing **Imported Win-Back** module (`winback.ts`, `/app/winback`)
     continues to target imported former clients / externally-sourced win-back
     opportunities. Unchanged by this ADR.
   - The new **Pipeline Win-Back** module targets **only stalled internal CRM
     opportunities** (staleness on `opportunities.stage`), via a new
     `v_pipeline_winback_due` view.
   - Each module owns its own eligibility, enrollment, analytics, templates, AI
     playbooks, and campaign config. Both **reuse** the shared campaign engine,
     scheduler, communications dispatcher/gate, consent enforcement, state
     machine, analytics framework, and operational controls.
   - A client/opportunity may participate in **only one** Win-Back campaign for
     the same objective at a time. **Precedence:** (1) an active advisor-owned
     opportunity, (2) Pipeline Win-Back, (3) Imported Win-Back.
   - **Shared suppression** (DNC/STOP, `do_not_contact`, compliance/legal holds,
     advisor ownership, active conversations, active appointments) applies across
     both modules. Enforced by the eligibility gate + the send gate.
   - Both appear as **separate campaigns** in the Campaign Center while sharing
     the same underlying infrastructure.
   - **"Quote expired"** has no expiration field on `opportunities` today, so it is
     modeled as a **staleness threshold** on `quoted_proposed` (no new field
     added), consistent with the rest of the staleness model.

## Decision

1. **New module `src/lib/pipeline-winback/*`** mirroring the Life Conversion
   architecture, with **collision-safe `pipeline_winback_*` naming** at the
   code/schema level (tables, types, API routes, job name, audit actions). The
   **UI-facing label stays "Win-Back Campaign."** Nothing is built on top of
   `winback.ts`.

2. **Eligibility source of truth = `v_pipeline_winback_due`** (migration 083),
   following the `v_conversions_due` / `v_cross_sell_gaps` pattern. It surfaces
   candidate opportunities that are **stalled or lost internal pipeline
   opportunities**, and encodes the hard suppression signals so the scheduler,
   dashboard, analytics, and manual-enroll API all read one definition (spec §0.9).
   The pure `evaluateWinbackEligibility()` is the single decision function that
   both enrollment and every per-touch tick call (re-checked before each touch).

   Candidacy: `is_security = false`, `deleted_at IS NULL`,
   `source NOT IN ('win_back','term_conversion')` (owned by Imported Win-Back /
   Life Conversion respectively — clean population separation), `stage ∈
   {prospect, fact_find, quoted_proposed, application, lost}`, household
   `do_not_contact = false`, **stale ≥ floor days** since last touch
   (`greatest(opportunity.updated_at, max(activities.created_at))`).

   Precedence / suppression encoded in the view + pure gate: excluded when the
   household has a **fresh/active advisor-owned opportunity** (any non-terminal
   opportunity touched within the staleness floor, or any `underwriting_suitability`
   opportunity), an **upcoming appointment**, or is opted out. The pure gate adds
   the **duplicate-enrollment** guard (one live enrollment per
   `(campaign, opportunity)`) and the configurable staleness threshold.

3. **Reuse, don't duplicate (CLAUDE.md §6).** The module-agnostic pure primitives
   — the **campaign/enrollment state machine** (`states.ts`), **advisor-touch
   policy** (`advisor.ts`), and **conversation timeout/owner** logic
   (`conversation.ts`) — are identical between the two campaigns and are **imported
   verbatim** from the first consumer (`src/lib/life-campaign/*`) through a small
   documented barrel `pipeline-winback/engine.ts`. They are **not** re-copied.
   Re-homing these primitives to a neutral `campaign-engine` namespace is a future
   refactor deferred here **only** because the life-campaign pure files are covered
   by brittle isolated-compile tests that assume self-contained files; re-homing
   now would churn those merged tests for no functional gain. The single
   unavoidable duplication is the ~15 lines of pure date math in `schedule.ts`
   (each campaign's schedule file must stay self-contained for its isolated test) —
   documented, not substantive logic.

4. **All sends stay on the existing rails.** Every client-facing touch routes
   through `sendThroughGate()` (consent, quiet-hours 9am–8pm local, DNC,
   approved-template, recommendation red-line, securities firewall). Templates seed
   as `approval_status = 'draft'` `comm_templates` (category `pipeline_winback` /
   `pipeline_winback_ai`) and cannot dispatch until approved (ADR-023). Audit goes
   through `writeAudit()` (append-only `audit_log`) — no new audit table.

5. **Operational controls (§5a)** reuse the shared 7-state machine (only `active`
   dispatches; `archived` terminal; `emergency_stopped` re-enable is deliberate),
   RBAC role-intersection (`admin`/`ops`/`super_admin`/`fsa`), and audited
   prev→next transitions. Enrollments distinguish `paused_for_conversation` (a
   reply) from `paused_by_admin` (a global Disable/Emergency-Stop).

## Consequences

- Two Win-Back campaigns exist and are clearly distinct in code and UI; future
  readers who find `winback.ts` first are protected by the naming split and this ADR.
- The `pipeline-winback` module depends on `life-campaign` for shared primitives.
  This makes `life-campaign` a de-facto shared home; ADR-031 §3 tracks re-homing.
- If Imported Win-Back later grows its own messaging campaign, the cross-module
  precedence/suppression here (do-not-double-target the same opportunity; shared
  gate-level frequency caps/DNC) is the contract it must honor.

## Rollback

Drop migrations 084 then 083 (`pipeline_winback_*` tables + `v_pipeline_winback_due`),
remove `pipeline-winback-tick` from the job registry + `vercel.json`, and delete the
`src/lib/pipeline-winback/*`, `/api/pipeline-winback/*`, and
`/app/comms/pipeline-winback` surfaces. No shared or life-campaign code changes to revert.
