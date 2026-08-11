# FSOS Campaign Audit Remediation — Implementation Report

- **Date:** 2026-08-11
- **Branch:** `claude/fsos-audit-fixes-yme4ii` (base `main` @ `511bf59`)
- **Prod DB (Supabase `supabase-FSOS`, ref `ynxaqeejjmeilpwmuuie`):** duplicate removal + campaign runtime reset applied here.
- **Scope:** the three campaign engines (Life Conversion, Cross-Sell Life, Pipeline Win-Back), the single gated communications pipeline, the duplicate Cross-Sell Life campaign, and a controlled runtime reset.

This remediation builds on the read-only audit (`reports/2026-08-10-outbound-comms-audit.md`) and the first-pass fixes in commit `df34dd9`. Every audit claim was re-verified against the live schema and the current code before changing anything; where the prior fix was correct it was kept and **strengthened**, not rewritten.

---

## 1. What each finding was, and what was done

### F-1 (P0) — Campaign message-of-record was silently lost

**Root cause (verified in prod):** `comm_messages.campaign_id` carries a foreign key `comm_messages_campaign_id_fkey → comm_campaigns(id)` (World-1 native-drip table). The three World-2 engines passed their own per-campaign-table id (`life_campaigns.id` / `xsell_life_campaigns.id` / `pipeline_winback_campaigns.id`) as `campaignId`, so **every** message-of-record insert violated the FK. supabase-js returns that error rather than throwing, and it was ignored — so ~88 real sends wrote no per-message record.

**Prior fix (`df34dd9`, kept):** the engines now pass `campaignId: null` and attribute the campaign through provenance columns (`source_kind='campaign_asset'`, `source_campaign_key=<family>`) plus the entity linkage (`entity → <engine>_enrollment → campaign`). The FK is now only ever fed World-1 ids, so it can no longer be violated. **Verified in prod:** recent campaign sends now carry `comm_messages` rows keyed by `source_campaign_key` (`life_conversion`, `cross_sell_life`, `pipeline_winback`) across delivered/blocked/failed statuses.

**Strengthened here (`src/lib/comms/send.ts`):** the pre-insert error is no longer merely logged — **the send now fails closed.** If the message-of-record insert errors *or returns no id*, `sendThroughGate` withholds the send entirely (the dispatcher/provider is never reached), records an escalating `comms.blocked` audit entry (`blockedStep: 'message_of_record'`), and returns a blocked outcome. A provider send can no longer succeed while its required §13.9 record fails to persist — the exact invariant F-1 demands. A transient DB fault now defers the touch (retried next cycle) instead of shipping an untraceable message.

**Tests:** `tests/comms-message-of-record-failclosed.test.mjs` (new) drives the **real** `sendThroughGate` with a fake DB whose `comm_messages` insert fails and a spy dispatcher, and proves: outcome `sent=false`/`blocked=true`, dispatcher **never** invoked, escalating reason names the withheld record; a control case (insert succeeds) proves a healthy send still reaches the dispatcher. `tests/campaign-message-of-record.test.mjs` (existing) proves the engine attribution (campaignId=null + provenance).

### F-2 (P0) — Channel-resolution produced blank SMS (67 real clients, Aug 7)

**Root cause (verified):** a template select of a non-existent `subject` column errored (42703) → `tpl=null` → channel defaulted to `'sms'` and body to `''`, so an email template shipped as a blank SMS. The immediate cause was fixed earlier (subject column removed from the selects), and the three engine ticks now fail closed on an unresolved/mis-channeled/empty template (`campaign-template-failclosed.test.mjs`).

**Strengthened here — an invalid message can no longer reach a provider from ANY caller:**
- **`src/lib/comms/gate.ts`** — a new **first** gate step `message_content` (escalating, checked before every other step) blocks: an unsupported channel, an empty/whitespace-only body, and email/HTML content routed onto the SMS channel (the Aug-7 mode). Because this validates the **authored** body *before* the dispatcher appends the SMS opt-out footer, the footer can never turn an empty message into a "non-empty" one that slips past a later check.
- **`src/lib/messaging.ts`** — provider-boundary backstops: `sendSms` rejects an empty/whitespace body and HTML-in-SMS before the Twilio call; `sendEmail` rejects an empty body before the Resend call. This is the last line before `api.twilio.com` / Resend and it fails closed, covering even a hypothetical caller that bypassed the gate.
- **`src/lib/comms/message-status.ts`** — the new step is classified as an escalating **blocked** tier with advisor-facing label/description (operator UI surfaces it, never a raw enum).

**Tests:** `tests/comms-message-validation.test.mjs` (new) proves, against the **real** gate + **real** dispatcher (spy) + **real** messaging guards, that empty SMS, whitespace SMS, empty email, the **Aug-7 email-template-on-SMS mode**, and an unsupported channel are all blocked at `message_content` and **never dispatched**, while a valid body passes.

### F-3 (P0) — Form-link SMS bypassed the compliance gate

**Prior fix (`df34dd9`, verified):** `src/lib/forms.ts` no longer places a raw inline Twilio `fetch`. The form-link SMS routes through `sendThroughGate` (`purpose=TRANSACTIONAL`, `humanAuthored=true`), so consent, DNC/STOP, the A2P 10DLC hold, the securities firewall, the audit trail, and the message-of-record all apply; the dispatcher owns the opt-out footer. `tests/forms-sms-gated.test.mjs` asserts no raw Twilio path remains and that the gate context is correct.

**Repo-wide bypass audit (this pass):** the entire `src/` tree has exactly **one** provider chokepoint — `src/lib/messaging.ts` (`sendSms` = the only `api.twilio.com` call; `sendEmail` = the only Resend call). There are **no** raw provider bypasses and **no** ungated SMS path anywhere else. The remaining direct-to-provider sends are all **email** and all transactional (`notifications/transactional.ts`, `notifications/account.ts`, the `forms.ts` email sibling, workshop-registration confirmation) plus one internal digest (`briefing/send`).

**Decision on the transactional emails (verified architectural reason, not gated):** the gate's email path is a *marketing* pipeline — it wraps the body in the marketing shell and attaches RFC 8058 List-Unsubscribe headers, and step 1 requires marketing consent. Routing transactional/auth email (a receipt, a form link, a password-setup mail) through it would be *wrong*: it would stamp marketing unsubscribe onto a receipt and could consent-block an auth email. Transactional email is legitimately CAN-SPAM-exempt and correctly uses the `notify.` transactional stream. This is the "verified architectural reason" the task allows. The genuine compliance risk — **SMS**, where TCPA/A2P applies to every message and there is no transactional-stream carve-out — is the one that was gated. The residual transactional-email observability gap (no `comm_messages` row) is the separate audit finding **F-7 (P1)** and is noted under §5.

### Duplicate Cross-Sell Life campaign — removed

There is **one** Cross-Sell Life *code* engine (`src/lib/cross-sell-life/**`). The duplicate was a **database row**: `xsell_life_campaigns` held two rows on one `family_key`:
- **v1** `f5c00000-0000-4000-8000-000000000001` — AUTHORITATIVE (49 enrollments, 98 executions, real activity).
- **v2** `96ac32e5-92e5-4655-9067-01ae35a1f853` — DUPLICATE (created 2026-08-02, archived 2026-08-03, **0** enrollments, **0** executions, never sent, but carried its own 35 duplicate touch rows).

**Verified before deleting:** only two tables FK to `xsell_life_campaigns` (enrollments, touches — both `ON DELETE CASCADE`); v2 had 0 enrollments; v2's touches referenced the **same** `comm_templates` as v1 (0 v2-exclusive templates, so nothing orphaned); the enrollment sweep and tick both select `status='active'`, so an archived row can never be scheduled/enrolled/ticked/restarted.

**Removed** via migration `supabase/migrations/111_remove_duplicate_xsell_life_v2.sql` — an idempotent, guarded transaction (refuses if the row has any enrollments; audits the removal to `audit_log` before deleting). Applied to prod. **Verified after:** campaigns 2→1, v2 gone, v1 intact (`paused`), touches 70→35 (only v2's cascaded), `comm_templates` 85 untouched, **0 orphan touches / 0 orphan enrollments**.

---

## 2. Controlled runtime reset (prod)

Executed a transaction-safe reset that mirrors the reviewed contract in `scripts/reset-campaigns.mjs` (`campaign-reset-contract.test.mjs` proves its preservation rules). Purged **only** per-contact execution state — the enrollment rows, which `ON DELETE CASCADE` to their executions (scheduled/pending/retry/failed state, idempotency keys, touch cursor/progression) and advisor-touch rows — plus the pending (`queued`) `outreach_queue`. Every purge is audited to `audit_log`.

| Table | Before | After |
|---|---|---|
| life_campaign_enrollments (→ executions 186) | 136 | **0** |
| xsell_life_campaign_enrollments (→ executions 98) | 49 | **0** |
| pipeline_winback_enrollments | 0 | 0 |
| outreach_queue (queued) | 0 | 0 |

**Preserved — verified byte-for-byte unchanged:** contacts (9,801), household_members (11,319), household_policies (9,088), comm_templates (85), all touch blueprints (life 20 / winback 24 / xsell 35), consents (19,322), comm_contact_consents (5), dnc_entries (0), comm_messages (86), comm_conversations (143), comm_message_events (658), compliance_events (22), and the `blocked` outreach_queue rows (30) that are gate-decision evidence. `audit_log` grew append-only (21,413 → 21,417: the 4 reset entries). No STOP/opt-out, consent, DNC, compliance, audit, contact, template, or authoritative-config row was deleted.

**Reactivation withheld (production safety):** all three campaigns are left **paused** and SMS remains A2P-held. The reset delivers clean runtime state; per the task's mandate, live production sending is **not** re-enabled — the operator flips campaign status (and `SMS_A2P_APPROVED`) to go live. A cleared enrollment set means each contact re-enrolls at touch 0 when the operator resumes.

---

## 3. End-to-end verification (via the test harness — no sends to real contacts)

Per the production-safety mandate, no live communications were sent to the ~11k real contacts. Each campaign stage is verified by the existing test suite plus the new F-1/F-2 regression proofs, all executed against the real compiled source:

| Stage | Coverage |
|---|---|
| Eligibility → enrollment | `life-campaign-eligibility`, `cross-sell-life-eligibility`, `pipeline-winback-eligibility` |
| Scheduling | `life-campaign-schedule`, `cross-sell-life-schedule`, `pipeline-winback-schedule` |
| Template resolution + **channel resolution (fail-closed)** | `campaign-template-failclosed`, `life-campaign-templates`, **`comms-message-validation` (F-2)** |
| Compliance gate (consent/quiet-hours/DNC/approval/personalization/securities/A2P) | `guardrail`, `guardrail-proof`, `p0-gate`, `p1-gate`, `campaign-gate`, `comms-a2p-gate`, `comms-contact-consent` |
| **Message-of-record (fail-closed)** | **`comms-message-of-record-failclosed` (F-1)**, `campaign-message-of-record`, `comms-message-status` |
| Provider dispatch | `guardrail-proof` (spy dispatcher, sender never invoked on block) |
| Delivery tracking / progression | `comms-campaign-timeline`, `life-campaign-states`, `cross-sell-life-states`, `life-campaign-resume`, `pipeline-winback-resume`, `life-campaign-retry` (idempotency) |
| AI conversation | `life-campaign-conversation`, `cross-sell-life-conversation`, `pipeline-winback-conversation`, `comms-ai-authority`, `ai-kill-switch`, `comms-turn-limit` |
| Appointment / pause / escalation | `pipeline-winback-booking-exit`, `comms-reply-classification`, `comms-two-way`, `booking-notify` |

**Blocked-communication cases (must fail safe):** no consent, DNC, STOP/opt-out (`consent-revoke`, `comms-two-way`), invalid phone/email (`messaging.ts` guards), **empty SMS** and **invalid channel/template** (`comms-message-validation`), duplicate execution/idempotency (`life-campaign-retry`, `booking-reminder-idempotency`), provider failure (`messaging.ts` `{ok:false}` contract), and **DB persistence failure** (`comms-message-of-record-failclosed`).

---

## 4. Validation commands & results

Exact commands run this session and their real results:

| Command | Result |
|---|---|
| `node scripts/run-tests.mjs unit` | **All 167 unit test files passed** (incl. the 2 new F-1/F-2 proofs). |
| `npm run type-check` (`tsc --noEmit`) | **Clean** (0 errors). |
| `npm run lint` | **No ESLint warnings or errors.** |
| `npm run build` (`next build`) | **Compiled successfully**; full route table generated (exit 0). |
| `node scripts/run-tests.mjs rls` | 11/12 files pass; only `comms-inbound-e2e.test.mjs` reports 2 assertion failures — **proven pre-existing** (see below). |
| `node tests/comms-message-of-record-failclosed.test.mjs` | 6/6 F-1 proofs pass. |
| `node tests/comms-message-validation.test.mjs` | 13/13 F-2 proofs pass. |

**Pre-existing e2e failures — clean-base comparison.** Running `tests/comms-inbound-e2e.test.mjs` on the untouched base commit `511bf59` (a fresh git worktree, isolated Postgres cluster, **none** of this session's changes) reproduces **exactly** the same 2 assertion failures and the same `125/127 checks passed` — proving they pre-date this remediation and are not caused by the F-1/F-2/F-3 changes (they concern the TRAIGA AI-disclosure footer and a quiet_hours/business_hours boundary at 20:30 local — audit findings F-6/F-9, out of this task's scope).

**Prod-side evidence.**
- Message logging works: `comm_messages` now carries `source_kind='campaign_asset'` rows keyed by `source_campaign_key` (`life_conversion` / `cross_sell_life` / `pipeline_winback`) across delivered/blocked/failed statuses.
- Duplicate removed: `xsell_life_campaigns` 2→1, v2 absent, v1 intact, touches 70→35, 0 orphans (§1).
- Runtime reset: enrollments/executions all 0, every preserved table byte-for-byte unchanged, `audit_log` append-only +4 (§2).

---

## 5. Known limitations / residual items (honest disclosure)

- **F-7 (P1) transactional-email observability** — the transactional email sends (receipts, form-link email, workshop confirmation) remain direct-to-provider by design (see §1 F-3). They still write no `comm_messages` row. This is a real, pre-existing gap; it is intentionally **not** closed by force-routing them through the marketing gate (which would be architecturally wrong). Recommendation: a lightweight transactional-purpose record path, tracked separately from this P0 remediation.
- **`comms-inbound-e2e.test.mjs`** has 2 pre-existing assertion failures (a quiet_hours-vs-business_hours boundary at 20:30 local, and the TRAIGA AI-disclosure footer) — both in code paths this diff does not touch (they concern audit findings F-9/F-6). See §6 for the clean-base comparison confirming they pre-date this work.
- **Live end-to-end sending was not exercised** against the production contacts — verification is by the test harness and code trace only, per the production-safety mandate. "Campaigns can start cleanly" is established by the cleared runtime state + the passing enrollment/scheduling/gate test suite, **not** by a live send.
- **Campaigns remain paused / SMS A2P-held.** Going live is an explicit operator action, deliberately left outside this remediation.
