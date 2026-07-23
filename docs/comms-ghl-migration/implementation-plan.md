# Implementation Plan — Native Comms Platform & GHL Decommission

> The 11 vertical slices (master build instruction §5), in order. **One draft PR per slice; do
> not start the next until the current is merged** (CI green: type-check, lint, `npm test`, RLS
> proof; diff matches scope; no blocking review findings). Parallelism only *within* a slice or
> across genuinely independent slices. Every slice: Discovery → Design → Schema (additive) →
> Backend → API → UI → Tests (TDD) → Verification → Docs, and each captures/compares the §14.A
> performance baseline.
>
> **Extend-before-build is mandatory** (master build instruction §0): before creating any table,
> column, route, component, service, hook, queue, or cron, search for an existing implementation
> and, if it satisfies ≥80%, extend it. The search result is recorded in the slice PR.

## Slice 0 — Discovery + ADRs (this PR)

Deliverables: the inventories in this folder, the feature-parity matrix, ADR-013 (canonical
`comm_*`), ADR-014 (GHL decommission). **Docs-only; no runtime/schema/UI change.** Establishes the
baseline that every later slice depends on and that must exist before any GHL line is deleted
(master build instruction §16). Also: capture the §14.A performance baseline harness plan
(campaign dispatch, inbox/conversation load, dashboard, template render, import duration, cron
latency, key API times, per-page query counts) so slice 1 can record first numbers.

## Slice 1 — D0: GHL export & reconcile (opt-outs first)

- **Purpose:** bring GHL state into FSOS as system of record, **without deleting code**.
- **Order:** (1) export every GHL DND/opt-out/unsubscribe → `consents`/`consent_ledger`/
  `dnc_entries` with `source='ghl_migration'`, original timestamps preserved; (2) contacts +
  custom-field values → `contacts`/`households`/`household_members`; (3) open opportunities +
  stage → native opportunities/pipeline; (4) appointments + message/activity history → `activity`
  + `comm_messages` where representable.
- **Extend:** reuse `/api/admin/imports/ghl` (already a GHL-CSV→spine importer) and
  `/api/app/contacts/import`; do not write a new importer.
- **Deliverable:** reconciliation report (counts per entity, matched/unmatched, conflicts,
  non-migratable). **Gate: zero unresolved opt-outs before slice 2.**
- **Tests:** GHL-migrated opt-out is honored by the gate; import idempotency; no orphaned rows.
- **Also:** first §14.A baseline numbers captured.

## Slice 2 — D1: replace GHL-triggered business logic natively

- Native pipeline/opportunity **stage-transition service** → creates a commission case at
  "Application Submitted" (idempotent), marks issued at "Issued"; native appointment logging;
  native consent/DND capture (verify Twilio-STOP + Resend-unsubscribe coverage in `gate.ts` /
  `inbound.ts`).
- **Reconciliation decision (document in PR):** the GHL webhook writes legacy `customers`/
  `commission_cases`; the aggregate root is `households`/`opportunities`/`cases` (ADR-001). Choose
  and document the native target per `docs/legacy-mapping.md`.
- **Feature-parity matrix approved in this PR** (required before D3).
- **Tests (TDD):** stage → case (once, idempotent on retry); securities opp firewalled (no
  auto-case); appointment logged; opt-out coverage. Prove before slice 10 (D2).

## Slice 3 — Delegated agency communication authority (§6)

- **Net-new** (delegation cannot fold into `agency_partnerships` — see data-model inventory §4).
  Add `AgencyCommunicationDelegation` (statuses DRAFT/ACTIVE/SUSPENDED/EXPIRED/REVOKED) — prefer
  columns on `agency_partnerships` only if they carry the full model; otherwise a dedicated table
  with RLS + a firewall-proof extension.
- Add **actual-sender vs represented-agent** fields to `comm_messages` (`actual_sender_user_id`,
  `actual_sender_identity_id`, `represented_agent_id`, `represented_agency_owner_id`,
  `represented_agency_id`, `contact_owner_id`, `communication_operator_id`) — never one ambiguous
  "agent" field.
- **Gate step:** add `delegation` to `gate.ts` (ACTIVE + in-window + permits campaign
  type/channel/sender/identity + contact belongs to that owner's book). On failure: block, pause
  enrollment, create exception, notify admin, audit.
- **Ownership ambiguity blocks sending** → assignment-review surface.

## Slice 4 — First-contact identity disclosure engine (§7)

- Platform-inserted approved disclosure (wording configurable — no hardcoded unverified
  legal/brand terms, §4.3). Compute/store the first-touch booleans
  (`is_first_campaign_touch`, `is_first_sms_touch`, `is_first_touch_by_sender`,
  `is_first_touch_on_behalf_of_agent`, `is_identity_refresh_required`, …).
- **Gate step:** `identity_disclosure` — a required-but-missing introduction blocks. Extends
  `personalize.ts` + `send.ts` (compute) and `gate.ts` (enforce).
- Trigger conditions: first-ever touch, new campaign, new purpose, different sender,
  reassignment, inactivity window, new channel, customer asks who's contacting. "Never imply"
  guardrails enforced in evaluations (slice 7).

## Slice 5 — Policy-engine extensions (§8)

Extend `gate.ts` — **do not replace it**. Add: **purpose classification** (MARKETING/
TRANSACTIONAL/SERVICING/APPOINTMENT/RELATIONSHIP/BIRTHDAY/WORKSHOP/APPLICATION_STATUS/
DOCUMENT_REQUEST/POLICY_DEADLINE) driving required consent/template/disclosure/unsubscribe/
quiet-hour/frequency/approval; **frequency caps** (per-day / 7-day, per-channel + combined, min
interval, max active campaigns); **campaign collision & priority**; wire the delegation (slice 3),
identity (slice 4), and data-confidence (slice 7) checks into the ordered chain. Extend
`consents`/`consent_ledger` with a **purpose axis** + a customer **preference center**; provider
suppression syncs into FSOS (FSOS authoritative). Preserve all existing steps
(consent, quiet-hours 9–20 floor, DNC, approved-template, recommendation, `is_security`).

## Slice 6 — Conversation mode vs campaign mode (§9)

**Net-new** (no pause-on-reply exists today — comms-platform inventory §8). On inbound reply: set
enrollment `PAUSED_FOR_CONVERSATION`, link reply to contact/household/campaign/sequence/owner/
sender, open/update thread, pause promotional automation, classify intent, notify assigned rep,
recommend next action. **Never send a "we haven't heard back" after a reply.** Resume only on
resolve / configured quiet period / authorized resume / policy-approved follow-up / different
campaign. Extends `comm_campaign_enrollments` + `inbound.ts` + the drip advancer.

## Slice 7 — AI authority matrix, evaluations & data confidence (§10)

- **AI authority matrix** enforced in **code + message classification** (not prompts):
  auto-send set vs draft-only set. Record AI worker/task/input/output/evaluation/approval/final
  action/timestamp (extends `agent_runs`/`agent_actions`).
- **Automated evaluations** that block on: wrong actual-sender/agency-owner/book, wrong
  on-behalf-of wording, missing first-touch disclosure, unsupported policy facts, unverified
  dates, wrong purpose/CTA, cross-agency contamination, unsupported recommendation, prohibited
  sensitive data in SMS, consent incompatibility, unapproved template.
- **Data confidence:** campaign-driving fields carry `value`/`source_document`/`source_system`/
  `extracted_at`/`verified_at`/`verified_by`/`confidence`. Unverified/conflicting/stale →
  exclude contact + verification task + show conflicting source + audit. **Mandatory for
  term-conversion dates.** Adds a `data_confidence` gate step.

## Slice 8 — Simulation mode (§11)

Safe mode that **never calls Twilio/Resend**. Per contact: enrollment/exclusion + exact reason,
resolved agency owner, actual sender, represented agent, sender identity, template version, fully
rendered SMS+email, scheduled send time, each gate decision (consent, suppression, preference,
quiet hours, frequency, collision, delegation, data confidence), expected sequence path + exit
conditions. **A simulation/preview pass is required before a campaign can activate.** Reuses the
pure `evaluateGate` + `campaign.resolveAudience` with the provider seam stubbed.

## Slice 9 — Campaign library (§12)

Versioned, approval-controlled blueprints on `comm_campaigns`/`comm_sequences`/`comm_templates`
(reuse the approval columns): Life Win-Back, Life Cross-Sell, Term Conversion, New-Lead Nurture,
Long-Term Nurture, Birthday (SMS+email staggered), Annual Review, Workshop invite/reminder/
follow-up (**integrate the existing workshop engine — do not duplicate**), Application Completion,
Document Request, Quote Follow-Up, Client Onboarding, Policy Delivery, Referral Request,
Re-Engagement, No-Response, No-Show Recovery, Appointment Confirmation/Reminder, Service
Notification. Rules: never imply a purchase from a quote/application; no coverage-gap claim
without a completed needs analysis; term-conversion requires verified data (slice 7) and stops on
completion/decline/opt-out/expiry/ineligibility/data-change; birthday relationship-only,
deduped on `contact_id+campaign_id+calendar_year+channel`, staggered; every campaign exits on
reply/appointment/opportunity/decline/opt-out/ineligibility/active-conversation.

## Slice 10 — D2–D4: GHL freeze, code removal, deferred schema retirement

- **D2 freeze:** disable outbound sync behind `ghlEnabled()`; keep `/api/webhooks/ghl` receiving
  into an audit log only; announce cutover in the runbook.
- **D3 remove:** delete GHL libs/routes/components/pages and every reference (per footprint audit
  §1–§10); retarget CSV/contact import to the native path; remove GHL env from config + docs;
  every removed route 404s/redirects; build green. **Feature-parity matrix must be approved first.**
- **D4 retire schema (separate migration, deferred):** drop `ghl_*` columns + `ghl_upload_batches`/
  `ghl_upload_rows` only after reconciliation sign-off + verified backup, with tested rollback.
- **D5 proof (in the D3 PR):** network-level decommission evidence (footprint audit §12).

## Slice 11 — Analytics/attribution + inbox polish (§13)

Extend `/app/comms/*` (no `/app/marketing/*`): campaign detail tabs (overview/sequence/audience/
enrollments/messages/replies/analytics/conversions/compliance/audit), segment builder, consent +
preference management, simulation surface, birthdays, and `/app/settings/communications/{twilio,
resend,senders,delegations,policies,quiet-hours,frequency}` (only where no equivalent exists).
Analytics distinguish **direct attribution vs influence** and **actual vs expected vs weighted vs
projected** revenue; SMS + email + business-outcome metrics; cost per appointment/opportunity/
conversion. `impeccable` a11y + polish pass.

## Cross-cutting invariants (every slice)

- Extend `lib/comms` + `/app/comms`; **never** a parallel platform, second gate/engine/model, or
  `/app/marketing/*`.
- All sends through `sendThroughGate` → `dispatch`; no component/AI-worker/server-action calls
  `messaging.ts` directly (standing grep check).
- Migrations additive + forward-only; RLS never weakened; the CI RLS firewall proof stays green
  and is extended for every new data-touching table.
- Securities firewall (`is_security`) and AI red-line hard-blocks preserved; TRAIGA AI disclosure
  on automated messages.
- TDD, git worktrees, systematic debugging, code review; mock Twilio/Resend — **never live sends
  from CI**.
- §14.A performance baseline re-measured and compared at slice end; §14.B production-readiness
  gates evidenced before any production deploy.
