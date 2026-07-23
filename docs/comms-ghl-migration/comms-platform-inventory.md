# Native Communications Platform — Inventory (extend, do not rebuild)

> The existing FSOS comms platform that all new work **extends** (master build instruction §0).
> Repo-grounded. This is the "extend before build" reference: before creating any table, route,
> component, service, or job, check here first.

## 1. `src/lib/comms/` — the 14 modules

| Module | Exports (key) | Responsibility |
|---|---|---|
| `gate.ts` | `GateStep`, `GateInput`, `GateResult`, `evaluateGate()` | **Pure** decision core — the 7-step gate (§3). No I/O. Additive: new steps extend the union + input + chain. |
| `send.ts` | `SendContext`, `SendOutcome`, `isTemplateApproved()`, `sendThroughGate()` | Send-time binding. Computes gate context **fresh from the DB**, threads conversation, personalizes, pre-inserts `comm_messages`, calls dispatcher, patches row + events. **The single choke point.** |
| `dispatcher.ts` | `DispatchRequest`, `DispatchResult`, `DispatchDeps`, `defaultDeps`, `dispatch()` | Execution core. Runs `evaluateGate`; ALLOW → footer + provider send (via `deps.send`); BLOCK → `compliance_events` + `agent_actions` escalation + audit, **never sends**. Injectable `deps` seam for tests. No force-send path. |
| `conversations.ts` | `resolveContact()`, `getOrCreateConversation()`, `touchConversation()`, `conversationIsSecurity()` | Threading — exactly one `comm_conversations` per `(channel, contact)`; resolves member→household→agency (+securities flag); recency/unread pointers. |
| `events.ts` | `normalizeProviderEvent()`, `recordMessageEvent()`, `findMessageByProviderId()` | Per-message immutable event ledger (`comm_message_events`); advances `comm_messages` lifecycle; guards terminal statuses. Analytics read here. |
| `hours.ts` | `loadHoursPolicy()`, `isWithinOperatingHours()` | Operator hours of operation (`comm_hours_policy` singleton). Can only **tighten** the legal floor; disabled ⇒ `true`. |
| `inbound.ts` | `processInbound()`, re-exports `classifyKeyword` | Single inbound entry (SMS+email): thread, record, STOP/START consent+DNC, escalate securities, optional gated AI reply. |
| `keywords.ts` | `Intent`, `STOP_WORDS`, `START_WORDS`, `HELP_WORDS`, `classifyKeyword()` | Pure carrier-standard keyword classifier on the first word. |
| `personalize.ts` | `personalize()`, `tokensIn()` | Merge-token substitution with safe defaults. Gate still re-checks the final body. |
| `resend.ts` | `verifyResendSignature()` | Resend webhook signature verify (Svix). **No provider send.** |
| `twilio.ts` | `verifyTwilioSignature()`, `emptyTwiml()`, `requestUrl()` | Twilio webhook signature verify + TwiML. **No provider send.** |
| `tracking.ts` | `instrumentEmailHtml()`, `safeRedirectTarget()`, `appBaseUrl()` | Email open/click instrumentation (pixel + click redirect). Best-effort telemetry, never a gate. |
| `campaign.ts` | `dispatchCampaign()`, `refreshCampaignMetrics()` | Broadcast/drip engine over **`comm_*`**. Resolves audience, A/B variant, idempotent enroll, routes each recipient through `sendThroughGate`. |
| `campaign-run.ts` | `buildCampaignSend()`, `fill()` | Pure row→send-context derivation for the **legacy** `/api/campaigns/run` drip (tables `campaigns`/`campaign_enrollments`/`customers`). |

## 2. The send path (single choke point)

```
caller ── sendThroughGate(ctx)                        [send.ts]
            │  normalize contact → getOrCreateConversation → personalize
            │  compute gate context FRESH: hasConsent, onDNC,
            │  isTemplateApproved, loadHoursPolicy, recipientLocalHour
            │  pre-insert comm_messages (queued) → instrument email HTML
            ▼
          dispatch(req)                                [dispatcher.ts]
            │  evaluateGate({ draft, channel, ...req.gate })   [gate.ts]
            ├─ BLOCK → compliance_events + agent_actions escalation + audit; return {sent:false}
            └─ ALLOW → append TRAIGA SMS footer → deps.send(...)
                         │
                         ▼
                   messaging.ts   sendSms() / sendEmail()      [ONLY provider invocation]
                     • sendEmail → new Resend(key).emails.send(...)
                     • sendSms   → fetch(api.twilio.com/.../Messages.json) + StatusCallback
            ▲
          patch comm_messages with outcome + provider_id; recordMessageEvent; touchConversation
```

**Provider-call invariant (verified):** `twilio.ts`/`resend.ts` are signature-verification only.
The **only** provider invocation is `src/lib/messaging.ts` (`sendSms`/`sendEmail`), reached
**only** through `dispatcher.ts`'s `defaultDeps.send`, reached only after the gate passes. The
legacy `/api/campaigns/run` was explicitly rewired off raw senders onto `sendThroughGate`.
*Later slices must keep this invariant:* no React component, AI worker, MCP tool, or server action
may call `messaging.ts` directly (master build instruction §14). A repo-wide grep for direct
`sendSms(`/`sendEmail(` callers outside `dispatcher.ts` is a standing security check (e.g.
transactional/auth email must not bypass the gate — confirm in the security slice).

## 3. The gate — 7 steps (+ 2b), in order

| # | Step | Blocks when | Escalates? |
|---|---|---|---|
| 1 | `consent` | no member-keyed or durable per-channel consent | Yes |
| 2 | `quiet_hours` | outside recipient-local 9:00–20:00 (TCPA floor, hardcoded `hour>=9 && hour<20`) | Yes |
| 2b | `business_hours` | `withinBusinessHours === false` (operator `comm_hours_policy`) | **No** — soft deferral, retried next cycle, audited `comms.deferred` |
| 3 | `dnc` | on internal/external DNC (`dnc_entries`) | Yes |
| 4 | `approved_template` | not an approved `comm_templates` row / approved AI policy / human-authored | Yes |
| 5 | `recommendation` | `containsRecommendationLanguage(draft)` matches red-line patterns | Yes |
| 6 | `is_security` | securities-flagged → FFS-supervised; audited `firewall.blocked` | Yes |
| 7 | `other_rule` | any FFS/Farmers/carrier/state/federal block | Yes |

**How to add a step (§6–§10 extensions):** (a) extend the `GateStep` union; (b) add `GateInput`
fields; (c) add a `BLOCK` reason; (d) insert the `if (...) return blocked(...)` at the correct
priority; (e) compute the new inputs at send time in `send.ts` and pass through
`DispatchRequest.gate`. Note `send.ts` currently populates
`hasConsent, recipientLocalHour, withinBusinessHours, onDNC, usesApprovedTemplateOrPolicy,
isSecurity` — it does **not** yet populate `otherRuleBlocked`. Purpose classification, frequency
caps, collision/priority, delegation, identity disclosure, and data-confidence gating all land
here as new steps + new send-time computations.

## 4. Quiet hours & keywords

- **Legal floor (step 2):** `withinQuietHours(hour)` in `src/lib/compliance/guardrail.ts` —
  hardcoded `hour>=9 && hour<20`, recipient-local. Not table-backed.
- **Operator hours (step 2b):** `comm_hours_policy` singleton (`id='global'`) —
  `enabled, start_hour, end_hour, days[], timezone_offset_hours` (default 9/20/all-days/−6).
- **Keywords** (`keywords.ts`): STOP = `stop, stopall, unsubscribe, cancel, end, quit, optout,
  revoke`; START = `start, unstop, yes, optin, subscribe`; HELP = `help, info`. **HELP is
  classified but not auto-answered** — it falls through to FSA escalation (no HELP auto-responder
  exists; a candidate for the §12 campaign-library / policy slice).

## 5. Cron topology

`vercel.json`:
- `/api/cron/renewal-watch` — daily `0 9 * * *` (09:00 UTC)
- `/api/cron/campaign-dispatch` — daily `0 12 * * *` (12:00 UTC)

Entry `src/app/api/cron/[job]/route.ts` — `GET`, authorized by `x-vercel-cron` or
`Bearer CRON_SECRET`; runs `runIdempotent('job:date', ...)` → `JOBS` registry
(`src/jobs/index.ts`). Comms-relevant handlers (`src/jobs/handlers.ts`):
- `campaignDispatch()` — active non-archived `comm_campaigns` → `dispatchCampaign` +
  `refreshCampaignMetrics` → `dripAdvance()`.
- `dripAdvance()` — due `comm_campaign_enrollments` → verify template approved → `sendThroughGate`
  → advance `current_step`/`next_send_at`.
- `workforceOrchestrator()` — AI outreach workforce; all sends via `sendThroughGate`.

Separate: `/api/cron/workshop-reminders` (workshop engine). Legacy `/api/campaigns/run` is a
`POST` internal route, **not** on the Vercel schedule (triggered externally). New scheduled work
extends this registry — do not add a second scheduler (master build instruction §0).

## 6. Webhooks (all `nodejs` + `force-dynamic`)

| Route | Verifies | Writes |
|---|---|---|
| `webhooks/twilio/inbound` | `verifyTwilioSignature` (401 on fail) | `processInbound({channel:'sms'})` → inbound `comm_messages` + `comm_message_events` + conversation + STOP/START consent/DNC + optional gated reply; empty TwiML. |
| `webhooks/twilio/status` | same | `normalizeProviderEvent` + `recordMessageEvent` → `comm_message_events` + `comm_messages` lifecycle. |
| `webhooks/resend` | `verifyResendSignature` (Svix, 401 on fail) | `email.*` → `recordMessageEvent` → events + lifecycle (opened/clicked/bounced/complained/delivered). |
| `webhooks/email/inbound` | `Bearer EMAIL_INBOUND_SECRET`/`x-inbound-secret` OR Resend sig | `processInbound({channel:'email'})` → inbound message + events + conversation + keyword consent/DNC + optional gated reply. |

Out of comms scope: `webhooks/ghl` (see footprint audit), `webhooks/zoom`, `webhooks/calendly`.

## 7. UI (`/app/comms/*`) and API (`/api/comms/*`)

**UI pages** (RSC, `load()` from `@/lib/data/query`): root timeline; `inbox` + `inbox/[id]`;
`sms`; `email`; `campaigns` + `campaigns/new` + `campaigns/[id]`; `templates` + `templates/[id]`;
`audience`; `sequences`; `analytics`; `delivery`; `suppression`. `load<T>(fn, fallback)` returns
`{ok,data}`/`{ok:false,kind}` so pages never throw an opaque 500.

**API routes** (all `requireApiRole('fsa')`; mutations add `requirePermission`):
`send` (POST, requires `template_id` + `idempotency_key`); `conversations` (GET);
`conversations/[id]` (GET/PATCH/POST); `templates` + `[id]`; `audiences`; `campaigns` + `[id]`
(activate/pause); `analytics`; `sequences`. Also `api/track/open/[id]`, `api/track/click/[id]`.

**Gaps the later UI slices fill** (extend these routes/pages — do not add `/app/marketing/*`):
campaign detail tabs (enrollments/replies/conversions/compliance/audit), segment builder, consent
+ preference center, simulation view, birthdays, and `/app/settings/communications/{twilio,resend,
senders,delegations,policies,quiet-hours,frequency}` (only where no equivalent exists).

## 8. Conversation mode — what exists vs. what is net-new

**Exists:** inbound threading, STOP/START consent+DNC, securities escalation, per-thread
`ai_autoreply` flag, inbox APIs.

**Net-new (§9 of the brief):** there is **no** "pause the drip/broadcast when the human replies"
mechanism. An inbound reply increments unread, opens the thread, records `replied`, and
auto-replies/escalates — it does **not** set enrollment `PAUSED_FOR_CONVERSATION` or suppress
active campaigns. Only STOP halts future sends (via consent/DNC). Conversation-mode
(reply-pauses-automation, "never send a we-haven't-heard-back after a reply") is a genuine new
behavior on `comm_campaign_enrollments` + the send path, not an existing feature to toggle.

## 9. Communication-flow inventory (every path that can send)

Every automated/manual outbound path in the app, and whether it goes through the gate:

| Path | Entry | Through `sendThroughGate`? |
|---|---|---|
| Manual one-off send | `/api/comms/send` | Yes |
| Inbox human reply | `/api/comms/conversations/[id]` POST | Yes (`humanAuthored` unless template) |
| Inbound AI auto-reply | `inbound.ts` `tryAutoReply` | Yes (`aiGenerated`, approved-AI-policy gate) |
| Broadcast/drip campaign | `campaign.ts` `dispatchCampaign` / cron `campaignDispatch`+`dripAdvance` | Yes |
| Legacy drip | `/api/campaigns/run` | Yes (rewired onto gate; legacy tables) |
| AI workforce outreach | `jobs/handlers.ts` `workforceOrchestrator` → `lib/ai/workforce` | Yes |
| Workshop reminders/nurture | `/api/cron/workshop-reminders` → `workshops/comms-engine.ts` | Yes (workshop log → `comm_messages`) |
| **Direct provider call** | `messaging.ts` `sendSms`/`sendEmail` | **The only bypass risk** — must remain callable only from `dispatcher.ts`. Standing grep check. |

## 10. Environment-variable inventory (comms-relevant)

| Var | Used by |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` / `TWILIO_MESSAGING_SERVICE_SID` | `messaging.ts` sendSms; `twilio.ts` signature verify |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | `messaging.ts` sendEmail |
| `RESEND_WEBHOOK_SECRET` / `SVIX_WEBHOOK_SECRET` | `resend.ts` verify |
| `EMAIL_INBOUND_SECRET` | `webhooks/email/inbound` |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_URL` | tracking links, Twilio status callback |
| `CRON_SECRET` | cron `[job]` auth |
| `CALENDLY_WEBHOOK_SECRET` | appointment booking (replaces GHL calendar) |
| `RETELL_API_KEY` | voice agents (config only; not wired into routes) |
| `FSOS_API_SECRET` / `FSOS_ADMIN_USER` / `FSOS_ADMIN_PASSWORD` | internal-API + command-center gate |
| GHL: `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET` | **removed in D3/D5** |
