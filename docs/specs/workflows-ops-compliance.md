# FSOS Part 3 — End-to-End Workflow Maps: Operations & Compliance

> Continuation of Part 3. Same convention: **Happy · Empty · Error · Unauthorized · Duplicate · Cancellation · Retry · Recovery.** 🛡 guardrail checkpoint · 📝 audit write · ⤴ escalation · 🔌 integration.

---

## WF-5 · Campaign Send (the gate is load-bearing)

**Trigger:** a campaign is activated (`/app/comms/campaigns/[id]`) or a scheduled step is due (`campaign-dispatch` job).

**Happy path:**
1. **Build.** `/app/comms/campaigns/new` (wizard): audience (segment/audience builder) → approved template(s) → schedule/cadence → consent + quiet-hours confirmation → review → activate. 📝 activation.
2. **Dispatch.** `campaign-dispatch` job iterates recipients. For EACH recipient, the 🛡 13-step dispatcher gate runs, blocking on the first failure: (1) ownership resolved · (2) valid channel consent · (3) within quiet hours (recipient-local, 9–20 floor) · (4) active in-scope delegation · (5) not on DNC · (6) approved template/policy · (7) not an individualized securities recommendation · (8) not is_security · (9) data-confidence on specific claims · (10) no other FFS/Farmers/carrier/state/federal rule block · then the non-escalating operational deferrals (11) business hours · (12) frequency caps · (13) priority collision. Canonical enumeration: `../data-guardrails.md` §5. 
3. **Result.** Pass → send via Twilio/email 🔌 → delivery status tracked (sent/delivered/failed). Fail → suppressed + reason recorded + ⤴ (if judgment needed). 📝 each send AND each block (never silently dropped).
4. **Delivery handling.** `/app/comms/delivery`: failed → retry (idempotent) or dead-letter; bounces update suppression.
5. **Analytics.** Send/response/opt-out rates in `/app/comms/analytics`.

**Empty:** empty audience → activation blocked ("no eligible recipients"). All recipients suppressed → campaign completes with a full suppression report, zero sends.
**Error:** provider outage 🔌 → sends queue + retry with backoff; no duplicate on recovery (idempotency key).
**Unauthorized:** unapproved template → cannot be attached; agent/campaign cannot send. Securities-flagged recipient/record → auto-suppressed 🛡.
**Duplicate:** idempotency prevents the same step sending twice to the same recipient.
**Cancellation:** campaign paused/stopped → in-flight step completes, no new sends; opt-out mid-campaign suppresses immediately.
**Retry:** failed sends retry per policy; exhausted → dead-letter + surfaced in delivery.
**Recovery:** inbound STOP (`webhooks/twilio`) → updates `consents`/DNC before the next send anywhere in the system.

**Invariant:** there is no "force send" control. The gate cannot be bypassed from any UI.

---

## WF-6 · Agency Activation & Dormancy/Reactivation

**Trigger (activation):** new agency partnership created. **Trigger (dormancy):** `agency-dormancy` job detects no referral within threshold.

**Happy path (activation):**
1. Create `/app/agencies/new` → `agency_activation` row at stage=identified + first check-in task. 📝.
2. Progress stages: identified → introduced → commitment → onboarded → first_referral → producing (`/app/agencies/[id]/activation` or global `/app/agencies/activation` board). Each drag 📝.
3. Agency Activation agent schedules green-zone check-ins (🛡 gate) + surfaces next best partner action (never a product rec).
4. First referral flips status→producing; rollups begin.

**Happy path (dormancy/reactivation):**
1. `agency-dormancy` job flags agencies with no referral in N days → status=dormant → appears in `/app/agencies/dormant`. 📝.
2. Reactivation task + green-zone re-engagement outreach (🛡 gate).
3. New referral → status back to producing.

**Empty:** no agencies → activation board empty with "add partnership" CTA.
**Error:** check-in send blocked (consent) → ⤴ manual outreach task.
**Unauthorized:** agency_owner cannot see other agencies (RLS).
**Duplicate:** one activation record per partnership.
**Cancellation:** partnership terminated → status=terminated; historical data retained (retention/audit).
**Retry/Recovery:** dormancy detection idempotent; reactivation escalates to FSA if no response.

---

## WF-7 · Commission Reconciliation

**Trigger:** placement creates an expected `commissions` row (WF-1 step 9); `commission-reconcile` job runs periodically.

**Happy path:**
1. **Expected.** On placed_issued → `commissions` row (total, split %s from `commission_splits` defaults [assumption-flagged], generated fsa/agency amounts, is_security, license_basis). 📝.
2. **Received.** Received commission recorded (manual entry or import — no invented Farmers payout API 🔌 fallback) → matched to expected.
3. **Reconcile.** `commission-reconcile` job compares expected vs received → match or flag discrepancy → `/app/commissions/discrepancies`. 📝.
4. **Resolve.** Adjustment (reason + audit), chargeback tracking, trail handling. Statements generated per period.
5. **Rollups.** Agency ytd_fsa_commission updates; partner sees attributed (if disclosure config on).

**Empty:** no placements → dashboards empty. 
**Error:** import parse error → row-level error report, partial import blocked (all-or-nothing per batch or previewed).
**Unauthorized:** agency_owner sees only own attributed, only if config permits.
**Duplicate:** received-commission dedupe on policy/period/amount.
**Cancellation:** chargeback → negative adjustment against placed business; 📝.
**Retry/Recovery:** reconciliation idempotent; unmatched items age into a discrepancy queue for manual resolution.

**Invariant:** split values are labeled config defaults; none presented as a Farmers-published figure.

---

## WF-8 · AI Agent Run → Escalation → Human Handoff

**Trigger:** a schedule fires or an event enqueues an agent run (`api/ai/run` → `jobs/agent-runner`).

**Happy path:**
1. **Start.** Runner checks 🛡 kill switch (per-agent + global). If off → no-op. Else create `agent_runs` (inputs, model, start). 📝.
2. **Reason.** AI gateway (Claude-first, fallback) produces output + confidence + token/cost. Logged to the run.
3. **Validate.** Any client-facing action → 🛡 `guardrail.ts`: blocks recommendation language, securities, no-consent, out-of-hours, DNC, unapproved template. 
4. **Act or escalate.** Pass + confidence ≥ threshold → act (green-zone: draft/send-consented/schedule/task/log), writing `agent_actions`. Fail OR low confidence OR judgment-required → ⤴ create escalation → `/app/ai/escalations`. 📝 action or escalation.
5. **Handoff.** FSA reviews `/app/ai/escalations/[id]` → approve/edit-and-send (through gate) / dismiss / reassign. Securities item → cannot send from FSOS, routes to FFS. 📝 decision.

**Empty:** nothing to do → run completes no-op, logged.
**Error:** provider error 🔌 → fallback model; if all fail → run errors → `/app/ai/errors` + retry.
**Unauthorized:** agent tool set is green-zone only; no agent holds a "recommend" tool; Compliance Guardrail agent cannot be disabled without super + second factor.
**Duplicate:** run idempotency prevents double-acting on the same trigger.
**Cancellation:** kill switch mid-flight → current run finishes logging, no new actions.
**Retry:** transient failures retry with backoff; exhausted → error + escalation.
**Recovery:** a recommendation slipping past the guardrail in eval = build-blocking defect; escalation queue is the only blocked→resolved path.

---

## WF-9 · Consent Capture & Revocation (gates everything)

**Trigger:** consent captured at referral/intake/portal, or revoked by client (`/client/consent`, `/consent/preferences`, inbound STOP).

**Happy path (capture):** consent recorded in `consents` (member, channel, status=granted, captured_at, source, disclosure text). 📝. Enables sends on that channel through the gate.
**Happy path (revocation):** STOP/opt-out or portal revoke → status=revoked + DNC updated → immediately authoritative over all campaigns/agents/sends. 📝.

**Empty:** no consent → no automated sends to that recipient (gate blocks). 
**Error:** ambiguous/unclear consent → ⤴ escalate (do not send).
**Unauthorized:** client can only manage own consent (RLS).
**Duplicate:** unique per member+channel; re-capture updates.
**Cancellation/Retry/Recovery:** revocation is instant and global; any in-flight campaign step re-checks the gate before send, so a just-revoked recipient is suppressed.

**Invariant:** consent + quiet-hours + DNC are checked at send time, not just enrollment time.

---

## WF-10 · Incident / Breach Response (Reg S-P / Safeguards)

**Trigger:** a security incident detected/reported → `/compliance/incidents`.

**Happy path:**
1. **Open.** Incident record created (scope, data types, discovery time). 📝. Starts the clock.
2. **Assess.** Determine if sensitive customer info was accessed; count affected individuals.
3. **Contain & notify.** Follow the runbook: service-provider notice (≤72h if applicable), affected-individual notice (≤30 days), FTC notice (≤30 days if ≥500 consumers). Tracked as workflow steps with deadlines.
4. **Close.** Remediation + post-incident review; retention/legal-hold applied to related records.

**Empty/Error/Unauthorized:** compliance/super only; access audited. 
**Duplicate:** one incident record per event; linked events grouped.
**Cancellation:** false alarm → closed with reason; 📝.
**Retry/Recovery:** deadline reminders escalate; missed-deadline flagged.

**Note:** dates/thresholds are the configured compliance floor; this is a workflow, not legal advice — counsel/FFS confirm specifics.

---

## WF-11 · Data Import (upload → commit → rollback)

**Trigger:** admin starts an import (`/admin/data/imports`).

**Happy path:**
1. **Upload** CSV → **field mapping** (source cols → FSOS fields) → **validation** (Zod per row, type/format/reference checks) → **preview** (exactly what will change; dedupe on email/phone/policy#) → **commit** → **error report** (per-row failures) → **audit + rollback token**. 📝.
2. Entities: agencies, households, policies, referrals, opportunities, commissions, documents.

**Empty:** empty file → rejected with message.
**Error:** row errors → reported per row; valid rows optionally committed or full batch held (previewed either way); no silent partial corruption.
**Unauthorized:** admin/super only.
**Duplicate:** dedupe at preview; duplicates flagged for skip/merge.
**Cancellation:** cancel before commit → nothing written.
**Retry:** re-run idempotent on the same file (dedupe prevents doubles).
**Recovery:** rollback restores pre-import state via the token; import audit history retained.

---

## Cross-workflow invariants (must hold everywhere)
- Every automated client-facing send passes the 🛡 13-step gate at SEND time (`../data-guardrails.md` §5).
- No securities substantive data enters FSOS; is_security is excluded from automation and routed to FFS 🛡.
- No AI action is a product/investment/replacement recommendation; those ⤴ to the human FSA.
- Every mutation, send, block, AI action, and stage change writes 📝 to `audit_log`.
- Every long-running job is idempotent, retries with backoff, and checks the kill switch.
- No workflow ends in a dead end: completion screens offer a next action; failures route to a queue, never silence.
