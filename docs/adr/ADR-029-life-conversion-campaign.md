# ADR-029 — Life Conversion Campaign (multi-channel timeline + Active Opportunity Ownership)

**Status:** Accepted
**Date:** 2026-07-31
**Owner:** FSOS Engineering

## Context
The Life Conversion Campaign is a 180-day, 20-touch outreach cadence that educates term-life
policyholders about a possible conversion privilege and invites a complimentary review (spec
"Life Conversion Campaign — Final Implementation Spec v4"). Three properties make it a poor fit
for the existing native campaign engine as-is:

1. **Multi-channel single timeline.** The native `comm_campaigns` row is single-channel
   (`channel: 'email' | 'sms'`, ADR-013) and drips a linear `comm_sequences` step list. This
   campaign interleaves **four** touch kinds on ONE per-contact timeline — email, SMS,
   AI-conversation initiation, and advisor outreach — with no two consecutive touches on the
   same channel in the accelerated phase. Advisor outreach and AI-conversation initiation are
   not "send a template" steps; they are net-new touch *types*.
2. **Deadline-anchored eligibility with opportunity ownership.** Eligibility is tied to a
   *verified* policy conversion deadline (`v_conversions_due`) and must yield to the CRM: an
   active `term_conversion` opportunity outranks the campaign.
3. **Operational lifecycle beyond active/paused.** §4b requires seven campaign states
   (Draft, Approval Pending, Active, Paused, Disabled, Emergency Stopped, Archived) with
   deliberate re-enable and terminal-archive semantics — the native status enum has four.

The reuse-first rule (CLAUDE.md §6) still binds: one dispatcher, one pause/resume lifecycle,
one eligibility source, one audit log, one RBAC. We must extend, not clone.

## Decision
Build the Life Conversion Campaign as a **dedicated module that reuses every enforcement layer**
and adds only what the native engine lacks:

- **Schema (migration 081):** `life_campaigns` (7-state lifecycle + config defaults),
  `life_campaign_touches` (the 20-touch template), `life_campaign_enrollments` (per-contact
  cursor + a status that distinguishes a reply-pause from an admin/global pause),
  `life_campaign_executions` (idempotent per-touch record — a touch is never sent twice), and
  `life_advisor_touches` (§9a due/reminder/escalation state that generic `work_tasks` lacks). No
  FK crosses into the NIGO island; RLS deny-by-default with internal-role reads only.
- **Reused, not rebuilt:** every client-facing send routes through `sendThroughGate()` (consent,
  quiet-hours 9am–8pm local, DNC, approved-template, recommendation, securities firewall,
  data-confidence). Pause-on-reply/resume reuses `comm_conversation_mode`/`evaluateResume`.
  Eligibility reuses `v_conversions_due` + the term-conversion stage vocabulary. Templates are
  DRAFT `comm_templates` behind the existing human approval gate (ADR-023) — "final copy" means
  engineering does not rewrite it, not that it skips approval. Audit is the append-only
  `audit_log` via `writeAudit()`. Controls authorize through `rbac.ts` role-intersection.
- **Scheduler:** a durable cron job (`life-conversion-tick`, registered in `src/jobs`) advances
  each active enrollment by at most one due touch per run (no burst / no auto catch-up), the
  multi-channel analogue of `dripAdvance`.

### Active Opportunity Ownership (owner-approved 2026-07-31, Checkpoint 1)
An active CRM `term_conversion` opportunity has higher priority than campaign automation. Once
an opportunity exists for the objective, the assigned advisor owns the relationship and campaign
automation for that objective pauses or exits until the opportunity reaches a terminal state:

- **Open opportunity** → ineligible for enrollment; an enrolled contact is exited on the next
  touch's recheck.
- **Closed Won** (`placed_issued`) → permanent exclusion.
- **Terminal-lost/cancelled** → re-eligible after a configurable `reenroll_cooldown_days`.
- **Reopened opportunity** → the enrollment is paused/exited immediately (eligibility is
  recomputed before enrollment AND before every scheduled touch).
- Only one owner — a campaign or an opportunity — per business objective at a time.

This coexists with the existing automatic origination (`originate.ts`), which continues to create
one open `term_conversion` opportunity per eligible policy from the same view; the ownership rule
is what prevents double-touch, enforced in the campaign's shared `evaluateEligibility`.

## Consequences
- **Positive:** no parallel dispatcher/scheduler/consent path; the firewall, red-line, quiet
  hours, and audit trail apply unchanged; the timeline is a pure, tested source of truth; the
  operational state machine and eligibility are pure functions with unit tests; a securities
  policy or an opened opportunity can never be campaigned.
- **Negative / follow-ups:** a second campaign-shaped schema now exists alongside `comm_campaigns`
  (justified by the multi-channel single-timeline requirement, isolated to `life_*` tables). The
  full conversational-AI intent playbook (§6a's 15 intents) and the appointment/application
  downstream workflows are wired at their campaign *boundaries* (pause on reply, exit on
  appointment/application/conversion, escalation handoff) and reuse existing conversation/
  opportunity subsystems for their internals — the intent-classification depth is the next slice.
  Schedule↔copy theme reconciliation (Checkpoint 2) remains open for compliance sign-off; copy is
  implemented verbatim meanwhile per spec §1.

## Alternatives considered
- **Overload `comm_campaigns` with a per-step channel + new step types.** Rejected: it would
  change a shared, single-channel contract every other campaign depends on (ADR-013) and blur the
  bounded context; the multi-channel timeline + 7-state lifecycle + advisor/AI touch state are
  genuinely additional, not a variant of the existing drip.
- **A fully standalone campaign platform.** Rejected outright (CLAUDE.md §6): it would clone the
  dispatcher, consent, pause/resume, and audit layers. This decision reuses all of them.
