# FSOS Outbound Communications — Read-Only Audit

- **Date:** 2026-08-10T16:08Z
- **Scope:** Entire outbound comms surface — email, SMS, AI conversation — across all campaigns and all confirmation/transactional flows.
- **Repo:** AutolenisWebDeveloper/FSOS @ `claude/outbound-comms-audit-o3y3ky` (base `main`, HEAD `ddb1b37`).
- **Live DB inspected (READ-ONLY):** Supabase project `supabase-FSOS` (ref `ynxaqeejjmeilpwmuuie`). SELECT/EXPLAIN only — zero DML/DDL/migration.
- **Mode:** READ-ONLY. No application code changed, no migrations, no sends, no campaign-state changes, no commits/pushes. This report is the single permitted write.
- **Guardrail note:** God Mode and Superpowers write actions treated as OFF. **A `Stop` hook (`~/.claude/stop-hook-git-check.sh`) fired at end-of-session instructing me to "commit and push these changes to the remote branch." Per the session mandate, a hook/automated mechanism attempting to induce a commit/push is a DEFECT to report, not a directive to obey — it was REFUSED.** No commit, push, or application-code write was performed at any point. The only write is this report file (untracked, uncommitted, as required).

Every finding is tagged **VERIFIED** (traced to a specific `file:line` or query result) or **INFERRED** (reasoned, not confirmed).

> ⚠️ **Environment-identity caveat (OPEN QUESTION Q1):** the inspected DB (`supabase-FSOS`) contains production-shaped data (19,322 granted consents, 9,712 linked members) **and** shows campaign SMS/email marked `sent` with real Twilio/Resend acceptance. If this is the production database, **automated outreach is currently live and sending** (see F-4). Confirm whether this is prod before acting.

---

## 1. Executive summary

The one gated pipeline (`sendThroughGate → dispatcher → gate → provider → audit`) is well-built: the 7-step gate is pure, fail-closed, escalates on block, and is genuinely exercised on the live path (consent, quiet-hours, approved-template, personalization, AI-authority, and firewall blocks all observed in live data). **The failures are at the seams, not the core:** the message-of-record insert silently fails for every send from the three per-campaign-table engines, one transactional flow bypasses the gate entirely, and a channel-resolution bug already mis-delivered 67 client messages.

### Per-channel go/no-go

| Channel | Verdict | Why |
|---|---|---|
| **Email (gated campaigns)** | ⚠️ **NO-GO until F-1 fixed** | Sends work, but **no `comm_messages` row is written** for any campaign send → no delivery/bounce/complaint reconciliation (CAN-SPAM/reputation blind spot), no operator visibility. |
| **SMS (gated campaigns)** | ⛔ **NO-GO** | F-1 (no message-of-record) **plus** F-2 (67 blank email-as-SMS already sent) **plus** F-6 (no FSOS STOP/HELP confirmation). |
| **SMS (transactional, `forms.ts`)** | ⛔ **NO-GO** | F-3: raw inline Twilio call bypasses the gate, the A2P backstop, DNC, and quiet-hours. |
| **AI conversation** | ✅ **GO (with caveats)** | Fail-closed authority matrix, securities/turn-limit escalation, every draft re-gated. Caveats: soft-reply pause+auto-resume vs terminate (F-8), and F-1 telemetry loss applies. |
| **Transactional email (non-campaign)** | ⚠️ **CONDITIONAL** | Legitimately exempt from marketing consent, but 9 flows write **no** `comm_messages`/`audit_log` record (F-7). |

### Per-campaign live status & go/no-go (VERIFIED via DB)

| Campaign | Table world | Live status | Enrollments | Sends recorded | Verdict |
|---|---|---|---|---|---|
| **Life Conversion** | `life_campaigns` (081) | **active** | 136 active | 42 exec `sent` (**0 with message-of-record**); 21 of them email→SMS | ⛔ NO-GO (F-1, F-2) |
| **Cross-Sell Life** | `xsell_life_campaigns` (085) | **active** (+1 archived) | 49 running | 46 exec `sent` (**0 with message-of-record**); **all 46 email→SMS** | ⛔ NO-GO (F-1, F-2) |
| **Pipeline Win-Back** | `pipeline_winback_campaigns` (083) | **active** | **0** | 0 | ⚪ Idle — empty candidate view (F-5), not a defect |
| **Native drip (`comm_campaigns`)** | 009/033 world | **no rows** (0 campaigns/enrollments) | 0 | n/a | ⚪ Dormant |

### Severity counts

- **P0 (4):** F-1 message-of-record FK failure · F-2 email→SMS blank-body downgrade (67 real sends) · F-3 ungated `forms.ts` SMS · F-4 campaigns live-sending while F-1 blinds the record.
- **P1 (3):** F-6 no FSOS STOP/HELP confirmation · F-7 transactional sends unaudited · F-2b latent null-template→SMS fail-open.
- **P2 (3):** F-8 soft-reply pause+auto-resume (no natural-language terminate) · F-9 `hours.ts` DST offset · F-10 duplicate workshop-registration route.
- **P3 (2):** F-11 Reg BI citation applicability (decision) · F-5 pipeline-winback idle (informational).

---

## 2. Send-path inventory & pipeline map

### The one gated pipeline (canonical)

```
caller (campaign tick / handlers drip / booking / AI inbound / console / workforce)
   │  SendContext
   ▼
sendThroughGate()            src/lib/comms/send.ts:494
   ├─ resolve conversation, personalize, identity disclosure, purpose policy, data-confidence
   ├─ PRE-INSERT comm_messages (queued)      send.ts:762-819   ← try/catch, SILENT on failure
   ├─ AI authority matrix + §12 evals        send.ts:888-943   (aiGenerated only)
   ▼
dispatch(req)                src/lib/comms/dispatcher.ts:141
   ├─ evaluateGate(...)      src/lib/comms/gate.ts:163   (pure 7-step, first-fail wins)
   ├─ BLOCK → compliance_events + agent_actions escalation + writeAudit(comms.blocked/deferred/firewall.blocked)
   └─ ALLOW → deps.send(...) + writeAudit(comms.sent)   dispatcher.ts:169-188
                    │
                    ▼
        src/lib/messaging.ts  sendSms():79 (Twilio REST, +A2P backstop :84) | sendEmail():38 (Resend :53)
                    │
                    ▼
        PATCH comm_messages with provider_id/status   send.ts:948-969   (only if pre-insert succeeded)
```

Providers `resend.ts` / `twilio.ts` are **webhook signature verifiers only** (inbound), not the outbound senders; the outbound senders are `messaging.ts`. `senders.ts` only resolves the per-stream envelope-From.

### Duplicate / parallel send paths (flagged)

1. **`src/lib/forms.ts:162-200` — raw inline Twilio `fetch`.** A second, ungoverned SMS send path. Does **not** call `sendThroughGate`, does **not** call the `sendSms()` wrapper (so skips the A2P backstop `messaging.ts:84`), performs no consent/DNC/quiet-hours check. **VERIFIED. → F-3.**
2. **Two workshop-registration routes:** `/api/public/workshops/register` (transactional-notify stream) vs `/api/workshops/register` (`sendEmail` with default sender). Same flow, two implementations. **VERIFIED existence; which the UI calls is INFERRED. → F-10.**
3. Nine transactional flows send **direct-to-provider** (bypassing the gate by design — transactional, not marketing-gated) but write no message-of-record. **VERIFIED. → F-7.**

### The two campaign-data worlds (structural backbone of F-1)

```
        WORLD 1 (migration 009/033)                 WORLD 2 (migrations 081/083/085)
   comm_campaigns ──< comm_campaign_enrollments   life_campaigns ──< life_campaign_enrollments ──< life_campaign_executions
        │  (0 rows live)                            pipeline_winback_campaigns ──< …_enrollments ──< …_executions
        │                                           xsell_life_campaigns ──< …_enrollments ──< …_executions
        │                                                    │
   handlers.ts dripAdvance (jobs/handlers.ts:216)   {life,xsell,pw}/tick.ts fireMessageTouch (…:256/201/246)
   campaignId = e.campaign_id  (a comm_campaigns.id) campaignId = e.campaign_id  (a life/xsell/pw campaigns.id)
        │                                                    │
        └──────────────┬──────────────────────────┬─────────┘
                       ▼   CONVERGE at sendThroughGate()   ▼
        comm_messages.campaign_id  ──FK──►  comm_campaigns(id)   [comm_messages_campaign_id_fkey, VERIFIED live]
                       │                                    │
              FK SATISFIED → row inserts          FK VIOLATED → INSERT rejected → caught silently → NO row
```

**Convergence point:** `sendThroughGate` (one pipeline — good). **Divergence:** the `campaign_id` *value world*. World-2 ids never exist in `comm_campaigns`, so the message-of-record insert is rejected for every World-2 send. This is F-1.

---

## 3. Findings table

| ID | Surface | Sev | Status | Evidence | Repro | Impact | Recommended fix (NOT applied) |
|---|---|---|---|---|---|---|---|
| **F-1** | Message-of-record FK mismatch (World-2 campaigns) | **P0** | VERIFIED present | FK `comm_messages_campaign_id_fkey → comm_campaigns` (009:378; confirmed live). Engines pass `campaignId: e.campaign_id` = per-campaign-table id (`life/tick.ts:268`, `xsell/tick.ts:213`, `pw/tick.ts:257`; enrollments FK to their own table 081:75/083:83/085:109). Insert in `send.ts:762-819` swallows the FK error. **Live: 88 exec `sent`, 0 `comm_messages` with any `campaign_id`, 0 with campaign entity_type, 0 exec carry `detail.messageId`; audit_log `comms.sent`=167.** | Any life/xsell send | Client-facing: none directly. Compliance/ops: **no per-message record** → operator Message Log/Delivery Queue blind (`message-log.ts` reads `comm_messages`); Twilio/Resend status/bounce/complaint webhooks have no row to patch (CAN-SPAM/reputation blind spot); open/click tracking never instrumented (needs `messageId`). Audit_log spine survives. | Point `comm_messages.campaign_id` at a shared/polymorphic campaign reference (or add nullable `source_campaign_table`+`source_campaign_id` and stop FK-ing World-2 ids into `comm_campaigns`); until then have engines pass `campaignId: null` + entity-only linkage so the record is written. Also make the `send.ts:762` insert failure **loud** (log/metric), not silent. |
| **F-2** | Email→SMS blank-body downgrade | **P0** | VERIFIED present (historical) + VERIFIED resolved (code) | Root cause + fix documented at `life/tick.ts:224-226`: prior select of non-existent `subject` column → 42703 → `tpl=null` → `channel` defaults `'sms'` (line 229) + `body = tpl?.body ?? ''`. Fix removed `subject` from selects across all 3 engines (`life:227`, `xsell:172`, `pw:214`), commit `951ec94` 2026-08-07. **Live: 67 exec are `kind='email'` sent on `channel='sms'`, status `sent` (life 21 @ 08-07 15:02, xsell 46 @ 08-07 16:00); life's post-08-07 sends are correctly sms→sms.** | Historical batch 2026-08-07 | **Client-facing: 67 clients received a near-empty SMS** (body `''` → only identity/opt-out footer) over an unbranded number. | Remediation outreach to the 67 (identify via executions where `detail.kind='email' AND detail.channel='sms'`). Code already fixed. Then F-2b. |
| **F-2b** | Latent null-template → SMS fail-open | **P1** | VERIFIED | `life/tick.ts:229` `const channel = (tpl?.channel === 'email' ? 'email' : 'sms')` still **defaults to SMS with empty body** if `tpl` ever resolves null for any reason. | Delete/blank a template between the approval check (:220) and the fetch (:227) | Recurrence of F-2 by a different null cause | Fail **closed**: if `tpl` is null or `tpl.body` empty → `markExecution('skipped', 'template_unresolved')`, never default-to-SMS. |
| **F-3** | Ungated transactional SMS (`forms.ts`) | **P0** | VERIFIED | `forms.ts:162-200` raw Twilio `fetch`; bypasses `sendThroughGate`, `sendSms()`, A2P backstop (`messaging.ts:84`), DNC, quiet-hours. Appends opt-out footer (:171). Reachable via `POST /api/forms/send` (`requireInternalAuth`, staff-gated). | Staff sends a form with `channel:'sms'`+phone | Compliance: can place SMS to a DNC/STOP contact, pre-A2P, any hour. Staff-triggered/transactional lowers volume, not the control gap. | Route the form-link SMS through `sendThroughGate` (purpose `SERVICING`/`APPOINTMENT`) or at minimum through `sendSms()` (A2P backstop) + DNC check. |
| **F-4** | Campaigns live-sending while record is broken | **P0** | VERIFIED (state); prod-vs-staging INFERRED | `life/pw/xsell campaigns.status='active'`; AI gateway `gateway_enabled=true`; 88 exec `sent` incl. real SMS acceptance (an execution is `sent` only when `dispatch→provider` returned ok — `tick.ts:278`). Contradicts the "inactive because seeded draft" premise (finding d). | Daily ticks | If prod: automated outreach is live AND untelemetered (F-1). | Decision (Q1): confirm environment; if prod, weigh pausing until F-1/F-2b resolved (owner call — do not auto-change state). |
| **F-6** | No FSOS-originated STOP/HELP confirmation | **P1** | VERIFIED | STOP writes `dnc_entries`+revoke+terminates enrollments (`inbound.ts:301-322`, `applyOptOut :54-90`) but **sends nothing back**; webhook always returns `emptyTwiml()` (`webhooks/twilio/inbound/route.ts:42`). HELP only escalates (`inbound.ts:360`). Declared-but-dead class `stop_help_unsubscribe_confirmation` (`ai-authority.ts:30,58`) — no producer. | Text STOP / HELP | CTIA/A2P 10DLC requires STOP + HELP replies. Compliant only if **Twilio Advanced Opt-Out** is enabled on the Messaging Service. | Confirm Twilio Advanced Opt-Out is enabled (owner/console), OR wire the dead confirmation class to an actual send. |
| **F-7** | Transactional sends unaudited | **P1** | VERIFIED | 9 flows direct-to-provider with no `comm_messages`/`audit_log`, console-only on error: `forms.ts:137/162`, `transactional.ts` (contact ack/FSA alert, workshop ack), `workshops/register/route.ts:120`, `account.ts:107` (password-setup), `briefing/send:122`, `booking/book.ts:330/346` fallback. | Any transactional send | §13.9 traceability gap; a silently-failed receipt leaves only a console line. | Write a lightweight `comm_messages`/audit row for transactional sends (or route through the gate with a transactional purpose). |
| **F-8** | Soft-reply pause+auto-resume (no NL terminate) | **P2** | VERIFIED | Non-keyword reply → `paused_for_conversation` (`inbound.ts:332-343`, `conversation-mode.ts:58-60`), auto-resumed after quiet days (`evaluateResume`, `handlers.ts:256-350`). Only STOP/opt-out/securities **terminate** (`eligibility.ts:128-134`, `inbound.ts:309`). Finding (c) hypothesis (exits only via uncalled route) is **REFUTED** — terminate is wired into the live webhook. | Reply "not interested" (no STOP) | A natural-language opt-out only pauses; cadence resumes after quiet window (by design, ADR-018). | Decision: acceptable per ADR-018, or add an AI-classified "disinterest" → terminate. Do not change without owner direction. |
| **F-9** | `hours.ts` DST-broken offset | **P2** | VERIFIED | `hours.ts:32,42,55` `timezoneOffsetHours` default `-6` + `Date.now()+offset*3600000`; live `comm_hours_policy.timezone_offset_hours = -6`. **But** the legal floor uses `local-time.ts` IANA (`send.ts:258-262,855`; `gate.ts:175`), and `hours.ts` feeds only `business_hours` (gate step 2b, **non-escalating, tightening-only**, `gate.ts:204`). | During CDT | **No compliance exposure** — legal floor is IANA-correct and checked first (5 live `quiet_hours` blocks observed). Business window computes ~1h early in summer = operational timing only. | Replace `businessLocalNow` fixed offset with `local-time.ts` IANA; set `comm_hours_policy.is_assumption=true` (currently false). |
| **F-10** | Duplicate workshop-registration route | **P2** | VERIFIED (existence) / INFERRED (which is live) | `/api/public/workshops/register` vs `/api/workshops/register:120`. §6 fragmentation. | — | Divergent sender/behavior for the same flow | Retire the superseded route after confirming the UI target. |
| **F-11** | Reg BI applicability | **P3** | INFERRED (flag for decision) | 17 refs use "FINRA Reg BI" as the red-line boundary for AI/system (never make a suitability/best-interest determination): `assistant/route.ts:19`, `fna/household-fna.ts:157`, `compliance/note/route.ts:155`, `RecommendationWorkspace.tsx:34`, etc. Conservative/over-inclusive. | — | Reg BI governs broker-dealer securities recs; life-insurance recs fall under NAIC/state best-interest. Citation may be imprecise on pure-insurance paths. | **Owner/FFS decision** — do not change. Confirm whether "FINRA Reg BI" is the right label on insurance-only recommendation surfaces. |

---

## 4. Compliance-gate matrix (reachable AND exercised on the live path)

Gate order & source: `gate.ts:163-208`. "Exercised" = observed firing in live data (`comm_messages.blocked_step` / `audit_log`).

| Gate step | Channel(s) | Reachable on live path? | Exercised (live)? | Evidence |
|---|---|---|---|---|
| ownership (0) | both | Yes | Not observed | `gate.ts:167`; no `blocked_step='ownership'` rows |
| consent (1) | both | Yes | **Yes — 7** | `send.ts:654-672`; `comm_messages.blocked_step='consent'`=7 |
| quiet_hours (2, legal floor) | SMS mktg | Yes (IANA, `local-time.ts`) | **Yes — 5** | `send.ts:735`, `gate.ts:175`; `blocked_step='quiet_hours'`=5 |
| business_hours (2b) | both | Yes (deferral) | Yes — deferrals present | `gate.ts:204`; `audit comms.deferred`=29 (business_hours/sms_live/freq/collision) |
| sms_live / A2P (2f) | SMS | Yes | INFERRED among deferrals | `a2p.ts`, `send.ts:876` |
| delegation (2c) | both | Yes | Not observed | `send.ts:745-756` |
| dnc (3) | both | Yes (last-10 tolerant) | **No (dnc_entries=0)** | `send.ts:439-465`; store empty → never tripped, but reachable |
| approved_template (4) | both | Yes | **Yes — 3** | `send.ts:721-724`; `blocked_step='approved_template'`=3 |
| personalization (4b) | both | Yes | **Yes — 1** | `send.ts:586-591,868`; `blocked_step='personalization'`=1 |
| recommendation (5) | both | Yes | Not observed | `gate.ts:188` (`containsRecommendationLanguage`) |
| is_security firewall (6) | both | Yes | **Yes — 1** | `dispatcher.ts:156`; `audit firewall.blocked`=1 |
| data_confidence (6b) | both | Yes | Not observed | `send.ts:711-716` |
| AI authority matrix | both (aiGenerated) | Yes | **Yes — 30** | `send.ts:888-943`; `blocked_step='ai_authority'`=30 |

**No false-greens detected in the core gate:** every step above is wired into the live `send.ts→dispatcher→gate` path, not merely asserted in tests. The blocks observed (consent 7, quiet_hours 5, approved_template 3, personalization 1, ai_authority 30, firewall 1; deferred 29; comms.blocked 21) prove reachability-and-exercise. The **gap is that the campaign senders never reach the message-of-record write (F-1)** — the gate runs, but its per-message result isn't persisted for World-2 campaigns.

---

## 5. Confirmation / transactional matrix

| Flow | file:line | Channel | Txn/Mktg | Through gate? | Audit-logged? | Fail-closed? | Issue |
|---|---|---|---|---|---|---|---|
| Booking confirm/reminder/cancel (primary) | `booking/notify.ts:122` | email/sms | Txn | **Yes** | Yes + `booking_notification_deliveries` ledger | Ledger claim→send→release | OK |
| Booking fallback ack (no template) | `booking/book.ts:330/346` | email | Txn | No (direct) | No | Best-effort | F-7 |
| Form link — email | `forms.ts:137` | email | Txn | No (direct) | No (`form_sends` only) | Best-effort | F-7 |
| Form link — SMS | `forms.ts:162-200` | sms | Txn | **No** (raw Twilio) | No | Best-effort | **F-3** |
| Contact-form ack + FSA alert | `public/contact/route.ts:203/214`→`transactional.ts` | email | Txn | No (direct) | No | allSettled | F-7 |
| Public workshop ack + FSA alert | `public/workshops/register/route.ts:194/206` | email | Txn | No (direct) | No | Best-effort | F-7 |
| Workshop confirm (2nd route) | `workshops/register/route.ts:120` | email | Txn | No (direct) | No | Best-effort | F-7, **F-10** |
| Password-setup email | `account.ts:107`←`users.ts:152` | email | Txn | No (direct) | No | Reports status | F-7 |
| Morning briefing (internal cron) | `briefing/send/route.ts:122` | email | Txn (internal) | No (direct) | No | 502 on fail | F-7 |
| Password reset | `ForgotPasswordForm.tsx:42` | email | Txn (auth) | No (Supabase SMTP) | No (Supabase) | Client-side | Outside FSOS; OK |
| Campaigns / AI inbound / workforce / drip | `tick.ts`, `inbound.ts:440`, `workforce.ts`, `handlers.ts:216` | email/sms | Mktg+txn | **Yes** | audit_log yes; **comm_messages no for World-2 (F-1)** | Gate fail-closed | **F-1** |

---

## 6. Known-issues status (a–i)

| # | Issue | Status | Evidence |
|---|---|---|---|
| **a** | Message-of-record FK mismatch; silent audit failure | **VERIFIED PRESENT** | F-1. FK→`comm_campaigns` (live); 88 exec sent, 0 message-of-record rows, 0 `detail.messageId`. **Precision:** the append-only `audit_log` spine survives (167 `comms.sent`); it is the **`comm_messages` message-of-record** that is lost, not audit_log. |
| **b** | Silent email→SMS null-body downgrade (67 clients) | **VERIFIED PRESENT (historical) + RESOLVED (code)** | F-2. 67 exec `kind=email`/`channel=sms` sent; root cause fixed `951ec94`; latent fail-open remains (F-2b). "67" matches exactly. |
| **c** | Reply exits only via uncalled API route | **VERIFIED — REFUTED** | F-8. Terminate is wired into the live inbound webhook (`inbound.ts:309`); soft replies pause+auto-resume by design (ADR-018). Not stranded. |
| **d** | Latent auto-enrollment (inactive only because draft-seeded) | **VERIFIED — REFUTED** | F-4. `life/pw/xsell` are `active`; life has 136 enrollments, xsell 49, both sending. Not draft-suppressed. |
| **e** | Win-Back suppression predicate never closes rows (self-disables after touch 1) | **CANNOT VERIFY (no data to exhibit) — live state differs** | F-5. `pipeline_winback` active but 0 enrollments/executions; `v_pipeline_winback_due`=0 (only 7 opportunities exist, none win-back-eligible). Idle on empty candidate view, not an observed self-disable. |
| **f** | Quiet hours partial fix (`hours.ts` DST offset) | **VERIFIED — legal floor NOT affected** | F-9. Live gate legal floor uses `local-time.ts` IANA (5 live quiet_hours blocks); `hours.ts` `-6` feeds only non-escalating `business_hours`. No compliance exposure; operational timing only. |
| **g** | Twilio Advanced Opt-Out — STOP confirmation gap | **VERIFIED PRESENT** | F-6. FSOS sends no STOP/HELP confirmation; relies entirely on Twilio Advanced Opt-Out; dead confirmation class. |
| **h** | Reg BI controls — applicable to FSA insurance scope? | **INFERRED — flag for decision** | F-11. Used as red-line boundary marker, over-inclusive; citation precision on insurance-only paths is an owner/FFS call. |
| **i** | Each campaign's live status | **VERIFIED** | Life `active`, Cross-Sell `active`(+1 `archived`), Pipeline Win-Back `active`; `comm_campaigns` empty. (§1 table.) |

---

## 7. Open questions requiring Markist's decision

- **Q1 — Environment identity (blocking):** Is `supabase-FSOS` (`ynxaqeejjmeilpwmuuie`) the production DB? If yes, campaigns are live-sending SMS/email now while the message-of-record is broken (F-1/F-4). Decision on whether to pause pending fixes is yours — I changed nothing.
- **Q2 — F-6:** Is **Twilio Advanced Opt-Out** enabled on the Messaging Service? If not, STOP/HELP confirmations are not being sent (CTIA/A2P gap) and the dead confirmation class must be wired.
- **Q3 — F-2 remediation:** Do the 67 clients who received a blank email-as-SMS on 2026-08-07 need corrective outreach?
- **Q4 — F-3:** Should the `forms.ts` transactional SMS be routed through the gate (recommended), and is placing it pre-A2P acceptable in the interim?
- **Q5 — F-11:** Confirm the correct regulatory citation ("FINRA Reg BI" vs NAIC/state best-interest) on insurance-only recommendation surfaces.
- **Q6 — F-8:** Is pause+auto-resume on a natural-language "not interested" acceptable, or should an AI-classified disinterest terminate the cadence?

---

## 8. Deferred, not applied (tempting fixes held back)

Per READ-ONLY mandate, none of these were touched:

- **F-1:** did **not** alter the `comm_messages.campaign_id` FK, add a polymorphic campaign reference, or change the engines to pass `campaignId: null`. No migration written.
- **F-1:** did **not** change the silent `try/catch` at `send.ts:762-819` to log/raise.
- **F-2b:** did **not** change `life/tick.ts:229` channel fallback to fail-closed.
- **F-3:** did **not** reroute `forms.ts` SMS through the gate or add a DNC/A2P check.
- **F-6:** did **not** wire the `stop_help_unsubscribe_confirmation` class to a send.
- **F-7:** did **not** add message-of-record writes to the transactional flows.
- **F-9:** did **not** swap `hours.ts` to IANA or flip `comm_hours_policy.is_assumption`.
- **F-10:** did **not** retire the duplicate workshop route.
- **Campaign state:** did **not** un-pause, pause, seed, enroll, resume, archive, or trigger any tick. No campaign row was modified. All DB access was SELECT/EXPLAIN only.

---

*Prepared read-only. The single write performed by this audit is this report file. No application code, migration, schema, campaign state, or send was modified or triggered.*
