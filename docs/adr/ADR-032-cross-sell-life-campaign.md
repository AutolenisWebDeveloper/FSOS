# ADR-032 — Cross-Sell Life Campaign (existing-client, no-active-life; multi-channel 35-touch timeline)

**Status:** Accepted
**Date:** 2026-07-31
**Owner:** FSOS Engineering

## Context
The Cross-Sell Life Campaign is a 180-day, 35-touch education-first outreach cadence inviting
**existing agency clients who hold a non-life product/relationship but have no active life policy,
application, or opportunity** to a complimentary life protection review, then moving interested
clients into the quote → application → policy workflows. It shares the shape of the Life Conversion
Campaign (ADR-029) and Pipeline Win-Back (ADR-031): a multi-channel single timeline interleaving
email, SMS, AI-conversation initiation, and advisor outreach, a 7-state operational lifecycle, and
per-touch idempotent executions. It is **not** a fit for the native single-channel `comm_campaigns`
drip (ADR-013) for the same reasons ADR-029 records.

Two properties are specific to this campaign:
1. **Audience = existing non-life client, no active life.** Eligibility is *not* deadline-anchored
   (no `v_conversions_due`). The base audience is `v_cross_sell_gaps` (`has_life = false`,
   `gap_count > 0`) — the same view the existing **Cross-Sell _agent_** uses — with the Life
   Conversion / Win-Back population separation, Active-Opportunity Ownership, consent, jurisdiction,
   duplicate, and cooldown gates layered on top.
2. **It must coexist with the existing Cross-Sell _agent_.** The `cross-sell-scan` job,
   `/api/cross-sell/[id]`, `v_cross_sell_gaps`, and `crosssell_*` activities are a green-zone
   *identify/invite* agent on a household — a different thing from this durable 180-day *campaign*.

## Decision
Build the Cross-Sell Life Campaign as a **dedicated module that reuses every enforcement layer** and
adds only what is genuinely new, in a distinct `xsell_life_*` namespace so it never collides with the
Cross-Sell agent.

- **Schema (migration 085 / seed 086):** `xsell_life_campaigns` (7-state lifecycle + **immutable
  versioning** via `family_key`+`version`, configurable daily-limit/cooldown/resume-behavior/
  replay-policy/weekend-holiday, kill-switch bookkeeping), `xsell_life_campaign_touches` (the 35-touch
  template), `xsell_life_campaign_enrollments` (the **full §15 enrollment state machine** — queue →
  running → pause/handoff → standardized terminal, with `previous_status` preserved and pinned
  `campaign_version`), `xsell_life_campaign_executions` (idempotent per-touch record with a
  deterministic `idempotency_key` + stored `template_version` — immutable history), and
  `xsell_life_advisor_touches` (§10 due/reminder/escalation state). Deny-by-default RLS, internal-role
  reads only; no FK crosses into the NIGO island.
- **Reused, not rebuilt:** every client-facing send routes through `sendThroughGate()` (consent,
  quiet-hours 9am–8pm local, DNC, approved-template, recommendation, securities firewall,
  data-confidence). Pause-on-reply reuses the shared `lib/comms/inbound.ts` pause (extended to pause
  the multi-channel campaign enrollments, incl. Life Conversion / Win-Back). STOP/HELP + unsubscribe
  reuse the keyword/opt-out layer. Templates are DRAFT `comm_templates` behind the ADR-023 approval
  gate — "verbatim copy" means engineering does not rewrite it, not that it skips approval. Booking /
  Zoom / calendar reuse `lib/booking` + `lib/zoom`; booking a review exits the enrollment
  (`exitOnAppointment`). Audit is the append-only `audit_log` via `writeAudit()`; controls authorize
  through `rbac.ts`.
- **Scheduler:** durable cron jobs (`cross-sell-life-enroll` daily eligibility+enrollment sweep to the
  configurable daily limit, `cross-sell-life-tick` advancing each running enrollment by at most one
  due touch per run — no burst / no auto catch-up — and `cross-sell-life-retry` for the dead-letter
  sweep), registered in `src/jobs`.
- **Versioning + operational controls (owner-approved):** editing an Active version is forbidden;
  changes create a new Draft version (`createNewVersion`) sharing the `family_key`; enrollments stay
  pinned to their version and historical executions are never mutated. Enable / Disable / Pause /
  Resume / Emergency-Stop / Archive plus configurable resume behavior (all_active / only_admin_paused
  / restart_day_1 / only_new) and replay policy (skip / replay — no auto catch-up by default) are in
  `controls.ts`, each writing `{control, prev, next, reason, actor}` to `audit_log`.

## Consequences
- **Positive:** no parallel dispatcher/scheduler/consent/booking/audit path; the firewall, red-line,
  quiet hours, and audit trail apply unchanged; the timeline, state machines, eligibility, and
  advisor/conversation policies are pure, unit-tested functions; a securities relationship or an
  opened life opportunity can never be campaigned; the campaign is fully admin-controllable without
  code changes.
- **Negative / follow-ups:** a third campaign-shaped schema now exists alongside `comm_campaigns`
  (justified by the multi-channel single-timeline requirement, isolated to `xsell_life_*` tables). The
  full conversational-AI intent playbook internals reuse the shared conversation subsystem at the
  campaign boundaries (pause on reply, exit on appointment/quote/application/policy, escalation
  handoff); deeper NLU is the next slice. Jurisdiction licensing uses an `ops_config`-driven default
  (`['TX']`) surfaced as an editable assumption (§4.3) until a licensing table exists. The
  `marketing-plan` skill named by the source spec is not installed; it is a documented, non-blocking
  repository limitation — all campaign copy is authoritative in the spec and implemented verbatim.

## Alternatives considered
- **Overload the Cross-Sell agent / `comm_campaigns`.** Rejected: the agent is a stateless
  identify/invite action and `comm_campaigns` is single-channel (ADR-013); the 180-day multi-channel
  timeline + full state machine + advisor/AI touch state are genuinely additional.
- **A standalone campaign platform.** Rejected (CLAUDE.md §6): it would clone the dispatcher, consent,
  pause/resume, booking, and audit layers. This decision reuses all of them.
