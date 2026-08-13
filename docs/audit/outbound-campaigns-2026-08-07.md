# Outbound Campaigns Audit — 2026-08-07

**Scope:** the three multi-channel campaigns (Life Conversion, Cross-Sell Life, Pipeline Win-Back)
and the shared send path (`sendThroughGate` → dispatcher). Evidence was gathered read-only from the
production Supabase project and the repository at commit `939af2c`. **No production data or code was
changed by this audit.**

**Bottom line:** production campaign SMS is really going out (Twilio provider IDs recorded,
consent and quiet-hours gates held), but **(1)** every campaign send since launch is missing its
`comm_messages` message-of-record because of a foreign-key dead-end that is silently swallowed, and
**(2)** the deployed build is sending **email-kind touches as near-empty SMS** — 67 clients have
received an SMS containing effectively no content. Both are send-path defects, not gate failures.

---

## Finding 1 (Critical) — No message-of-record for any campaign send

`comm_messages.campaign_id` carries `FOREIGN KEY (campaign_id) REFERENCES comm_campaigns(id)`
(`comm_messages_campaign_id_fkey`). The three campaigns do **not** live in `comm_campaigns`
(0 rows); their IDs live in `life_campaigns`, `xsell_life_campaigns`, and
`pipeline_winback_campaigns`. Every campaign send therefore fails the pre-insert at
`src/lib/comms/send.ts:763–816` with FK violation 23503, which is swallowed by the best-effort
`catch {}` at `send.ts:817–819`.

Verified consequences:

- `comm_messages` holds 83 rows total, **0 with a `campaign_id`** — despite 66+ campaign sends in
  the last 4 days.
- The row that should carry the **body snapshot, `consent_at_send`, purpose, template linkage,
  member/household linkage, identity-disclosure record, and delivery status** is never written.
- `messageId` is `undefined` downstream, so the delivery-status patch never runs and **email
  open/click instrumentation is disabled** (`send.ts:837` requires `messageId`).
- The only surviving evidence per send is the `audit_log` `comms.sent` row (actor, channel,
  recipient, provider id) — which contains **no body and no consent basis**.

This violates §13.9 (auditability: who/what/which record), weakens the §12 TCPA defense record
(consent *did* gate the send, but the at-send consent snapshot is not persisted), and contradicts
ADR-013's canonical `comm_*` message model.

**Recommended fix (in order):**
1. Reconcile the campaign registry: either register the three campaigns in `comm_campaigns` with
   the same UUIDs, or amend the FK per an ADR-013 update (e.g. drop the FK in favor of a
   polymorphic `campaign_key`). Decide once, in an ADR — don't patch ad hoc.
2. Stop swallowing the insert failure: log it, write a `compliance_events`/escalation, and treat
   "message row cannot be written" as a **send-blocking** failure for campaign sends (the record is
   part of the compliance contract, §13.9/§16.4).
3. Backfill: reconstruct `comm_messages` rows for the historical sends from `audit_log` +
   execution rows as far as the data allows, flagged as backfilled.

## Finding 2 (Critical) — Email touches dispatched as near-empty SMS in production

67 executions whose touch `kind = 'email'` were actually sent on `channel = 'sms'`:

- `life_campaign_executions`: 21 sent (actor `agent:marketing_automation`, daily ticks since 08-04)
- `xsell_life_campaign_executions`: 46 sent (actor `agent:cross_sell`, 2026-08-07 16:01 UTC)

Every one of these rows records `template_version: null`, proving the template fetch returned
`null` at send time in the deployed build (the stale column-list select; fixed at repo head,
`src/lib/cross-sell-life/tick.ts:172`). With `tpl == null` the code falls into:

- `tick.ts:174` — `tpl?.channel === 'email' ? 'email' : 'sms'` → **defaults to `'sms'`**
- `tick.ts:205` — `body: tpl?.body ?? ''` → **empty body**
- `tick.ts:175` — `to = member?.phone` → dispatched to real phone numbers (Twilio provider IDs in
  `audit_log`)

So 67 clients received an SMS consisting only of the platform-prepended identity disclosure and the
`Reply STOP to opt out.` footer — no actual message content. Consent (46/46 xsell recipients had
granted SMS consent) and quiet hours (11:01 CT) held, so this is a content/audit failure, not a
TCPA violation — but it burns segment budget, looks broken to clients, and consumed touch #1 of
each timeline with nothing.

**Recommended fix:**
1. Deploy the current repo head (which fixes the select) — but also:
2. **Fail closed on a null template** in all three tick files: a message touch whose template
   cannot be loaded must be marked `skipped`/escalated, never defaulted to SMS with an empty body.
   This defect still exists at repo head.
3. FSA decision: whether to re-fire touch #1 (the timelines have consumed it) and/or acknowledge
   the broken texts to the 67 recipients.

## Finding 3 (High) — Template approval state vs. live campaigns drifted mid-day

`comm_templates` for the campaign touches were reset to **version 3** at 20:20 UTC on 2026-08-07 —
*after* the 16:01 UTC sends (which legitimately passed `isTemplateApproved` against the prior
approved v2). Current state: Life touch-1 template **approved v3**; all Cross-Sell Life touch
templates **draft v3**.

With all three campaigns still `status = 'active'`:
- Life will keep sending on the next tick — through the same deployed build that produced the
  blank-SMS behavior in Finding 2.
- Cross-Sell will skip on `template_not_approved` (fail-closed check, `tick.ts:168`) *if* the
  deployed build has that check — unverified for the running deployment.

**Recommendation:** pause all three campaigns (`status = 'paused'`) until the Finding 1 and
Finding 2 fixes are deployed and verified, then re-approve templates and resume. Ticks fire daily
around 15:00–16:00 UTC — this is time-sensitive.

## Finding 4 (High) — Campaign DDL applied outside migration tracking

`supabase_migrations.schema_migrations` ends at `20260717213002` (2026-07-17), yet the campaign
tables, seeds, and v3 template resets exist in production and are dated 2026-07-31 → 2026-08-07.
Schema changes are reaching production outside the forward-only, reviewed migration path (§10),
which is how the Finding 1 FK mismatch and the Finding 2 column drift went unnoticed.
**Recommendation:** reconcile the applied-DDL history into tracked migrations and restore the
single migration path.

## What held (verified working)

- **Consent gate:** 46/46 SMS recipients checked had granted SMS consent (`consents`).
- **Quiet hours:** sends at ~11:00 AM CT, inside the 9am–8pm floor.
- **Audit log:** `comms.sent` rows written for every send with actor, channel, recipient, and
  provider id (`ok: true`).
- **A2P:** provider IDs confirm Twilio accepted the traffic; the A2P hold (`tick.ts:178`) is not
  blocking, i.e. registration is in effect.
- **Approval fail-closed:** `isTemplateApproved` (send.ts:266) fails closed on error and on
  draft/archived templates, and the 29 earlier Life skips (`template_not_approved`) show it
  working.

## Evidence index

| Fact | Source |
|---|---|
| FK `comm_messages.campaign_id → comm_campaigns(id)` | `pg_constraint` `comm_messages_campaign_id_fkey` |
| `comm_campaigns` empty; campaign IDs elsewhere | row counts: comm_campaigns=0, life=1, xsell=2, pwb≥1; overlap=0 |
| 0/83 `comm_messages` rows carry `campaign_id` (66 in last 4 days) | `comm_messages` aggregate query |
| Swallowed insert | `src/lib/comms/send.ts:761–819` |
| 21+46 email-kind executions sent as SMS, `template_version: null` | `life_campaign_executions`, `xsell_life_campaign_executions` |
| SMS fallback + empty body on null template | `src/lib/cross-sell-life/tick.ts:172–205` (same pattern in the other ticks) |
| Sends 16:01 UTC 08-07 to real numbers, provider IDs, no body/consent in diff | `audit_log` `comms.sent` rows, actors `agent:cross_sell` / `agent:marketing_automation` |
| Template v3 reset at 20:20 UTC 08-07; xsell drafts, life approved | `comm_templates` `updated_at` / `approval_status` |
| 46/46 recipients SMS-consented | `consents` join on sent enrollments |
| Migration tracking ends 2026-07-17 | `supabase_migrations.schema_migrations` |

---

## Remediation (2026-08-13)

Owner-directed follow-up. Before remediation landed, one further Life Conversion tick fired
on 2026-08-10 (21 more sends via the same blank-SMS path), bringing the Finding 2 total to
**88** affected sends.

1. **All three campaigns paused** (production, 2026-08-13 02:28 UTC): `life_campaigns`,
   `xsell_life_campaigns`, `pipeline_winback_campaigns` → `status = 'paused'`, with
   `campaign.paused` audit-log entries recording the reason. Nothing sends until the FSA
   re-activates after verifying the deployed build includes the fixes below.
2. **Finding 1 fixed — message-of-record.** Migration `109_comm_campaign_engine_registry.sql`
   (applied to production and tracked) mirrors every engine campaign into `comm_campaigns`
   as an inert, archived registry row — same UUID, `category='engine_registry'` — with DB
   triggers keeping the registry in sync for future campaign rows, so the
   `comm_messages.campaign_id` FK now holds. `sendThroughGate` no longer swallows a failed
   pre-insert: a send whose message-of-record cannot be written is **blocked**, audited
   (`comms.blocked`, step `message_record`), and escalated (`src/lib/comms/send.ts`).
   Decision recorded in ADR-013 (amendment).
3. **Finding 2 fixed — blank-SMS fallback.** All three ticks now fail closed on an
   unloadable/channel-less/empty-bodied template via the shared `usableTemplate()`
   predicate (`src/lib/comms/usable-template.ts`) — the execution is left `'scheduled'`
   with reason `template_load_failed` (A2P-hold semantics: retried next run, never
   consumed, never defaulted to SMS with a blank body).
4. **Guardrail test:** `tests/campaign-send-fail-closed.test.mjs` proves the predicate and
   statically asserts the fail-closed wiring in all three ticks and `send.ts` (§13.13 —
   may not be weakened).

**Still open:** deploy this branch to production before re-activating any campaign (the
2026-08-10 sends prove the deployed build predates the repo-head select fix); Finding 3
(re-approve xsell v3 templates); Finding 4 (reconcile migrations 021–108 into tracking);
FSA decision on re-firing the consumed touch #1 / acknowledging the 88 broken texts.
