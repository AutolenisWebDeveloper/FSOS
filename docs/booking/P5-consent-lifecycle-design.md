# P5.1 — Booking Notification Automation: Consent Model + Lifecycle Matrix (DESIGN)

> **Design only — no SMS send code.** Produced before any P5 send-path build (owner directive,
> turn-by-turn). Grounds P5 in the existing ONE gate (`gate.ts` `evaluateGate`, 13 steps) and the
> existing consent stores — no second engine, no bypass. Loaded via `twilio-a2p-compliance`.
> **P5.0 confirmed:** the Section-3 shared-render fix (`a380269`) is an ancestor of HEAD and on
> `origin/main`; `personalize.ts` blocking-token contract intact → lifecycle templates render booking
> data; **do not modify `personalize.ts`/`notify.ts` for rendering.**

## 1. Current state (verified)

- **Email** booking consent IS captured: on booking, `book.ts` writes a `consent_intent` activity
  (`channel:'email'`, `scope:'booking'`, `CONSENT_DISCLOSURE_VERSION`) + `consent.captured` audit.
  Confirmation/reminder/cancellation **email** flows through `sendThroughGate` today.
- **SMS consent is NOT captured and NEVER inferred** (`book.ts:189`). The public booking form
  collects name/email/phone/notes only — **no SMS opt-in checkbox**. Reminders are **email-only**.
- Consent stores: `consents unique(member_id, channel)` (member-keyed) + companion
  `comm_consent_purposes unique(member_id, channel, purpose)`; `dnc_entries`; STOP/START via
  `keywords.ts`. Booking bookers are **contacts** (may not be `household_members`), so the
  member-keyed `consents` table doesn't directly cover them — contact-level consent evidence
  (`contact-consent.ts`: `latestConsentGranted`/`smsTail`/`consentContactKey`) is the relevant path.
- SMS only sends when A2P is live (`smsLiveFor`); A2P brand/campaign values are `is_assumption`.

## 2. Consent model for booking SMS

**Principle:** SMS requires **TCPA prior express written consent**, captured explicitly, never
inferred from the email opt-in, re-checked fresh at send time by the gate, and instantly revocable
by STOP.

1. **Capture (new, at booking):** a **separate, unchecked** SMS opt-in on the public form + a
   disclosure (approx: *"I agree to receive appointment text messages at this number from [FSA].
   Msg & data rates may apply. Reply STOP to opt out, HELP for help."*), versioned
   (`SMS_CONSENT_DISCLOSURE_VERSION`). Phone required if opted in. **Never pre-checked; independent
   of the email opt-in.**
2. **Store:** a durable per-channel evidence row mirroring the email pattern — a `consent_intent`
   activity `channel:'sms'`, `scope:'booking'`, version — keyed to the contact (+ audit
   `consent.captured channel:'sms'`). If/when the booker maps to a `household_member`, also reflect
   a `consents(member_id,'sms','granted')` row so the member-keyed gate path sees it. **Decision
   D-P5-1 (below): contact-level primary vs member mapping.**
3. **Gate integration (step 2 `consent`):** the SMS leg passes a **real** SMS-consent signal
   resolved from that evidence — **NOT** `consentWaived`/`durableConsentGranted` (the email path's
   transactional waiver). The gate then applies steps 1–13 fresh: ownership, consent, **quiet_hours
   (9–20 recipient-local, non-negotiable)**, delegation, **DNC/STOP**, approved template,
   recommendation (n/a — templated), is_security (n/a — booking rows `is_security=false`),
   data_confidence, other_rule, then the operational deferrals.
4. **Opt-out:** inbound **STOP** (`keywords.ts`) revokes SMS consent + adds DNC for the contact key
   (`smsTail`/`consentContactKey`); START re-consents. Opt-out is instant and blocks every later SMS
   leg at gate step 2/5. A genuine reply also pauses promotional drips (not booking transactional).
5. **A2P + flag:** SMS legs are behind an explicit **feature flag (default OFF)** AND `smsLiveFor`
   (A2P live). The flag is the immediate rollback lever (deploy-notes). A2P registration stays a
   labeled config default until verified.
6. **TRAIGA (Texas) AI disclosure:** booking notices are **approved, human-authored templates** (not
   AI-generated), so the AI-authored-message disclosure is arguably out of scope — but the approved
   SMS templates will carry the standard identity + STOP/HELP language; **confirm whether a TRAIGA
   AI-disclosure line is required on these transactional notices (D-P5-3).**

## 3. Lifecycle matrix

Channels: **Email** = existing (transactional booking consent). **SMS** = new (explicit SMS opt-in,
behind the flag). Every row passes the ONE gate; securities n/a (`is_security=false`); templates are
approved artifacts (ADR-025 author-time render).

| Event | Trigger | Email (today) | SMS (P5, gated) | Template source_key | Notes |
|---|---|---|---|---|---|
| **Confirmation** | on booking | ✅ `sendBookingConfirmation` | opt-in + gate | `appointment-confirmation` (+ `-sms`) | transactional; sent immediately |
| **Reminder** | pre-appt lead (cron) | ✅ `runBookingReminderPass` | opt-in + gate; **quiet-hours DEFERS** | `appointment-reminder` (+ `-sms`) | fixed-lead send may land in quiet hours → gate step 3/11 holds to next in-hours window; idempotent via `reminder_sent_at` |
| **Rescheduled** | on reschedule (public + FSA) | ⚠️ **reclassify** — currently re-sends *confirmation*; send a dedicated **rescheduled** notice | opt-in + gate | **new** `appointment-rescheduled` (+ `-sms`) | P2 handoff item; reminder already re-anchored (P2.4). Must NOT read as a fresh "you're booked" |
| **Cancellation** | on cancel | ✅ `sendCancellationNotice` | opt-in + gate | `appointment-cancellation` (+ `-sms`) | transactional |

**Classification:** all four are **transactional/informational** (about a user-initiated
appointment), **low-risk / green-zone** (schedule/remind — no recommendation, no securities). They
are approved templates, not AI-authored, so the AI-authority matrix is n/a (auto-send-eligible once
the gate passes). Consent + quiet-hours + DNC/STOP still gate every SMS leg.

## 4. Scope boundary — what P5.1 does NOT build

This is design only. The following are **later P5 slices, each brought back as a diff before commit**
(no auto-proceed): (a) the SMS opt-in capture (form + `book.ts` `consent_intent(sms)` + audit);
(b) approved SMS templates (author-time, ADR-025); (c) the SMS leg in `notify.ts` per event via
`sendThroughGate({channel:'sms'})`; (d) the **rescheduled** reclassification (template + wiring, so
reschedule stops re-sending the confirmation); (e) the feature flag + A2P-live gating. **No send path
is added or modified in P5.1.**

## 5. Open decisions for the owner (gate the build)

- **D-P5-1 — SMS consent storage:** contact-level `consent_intent(sms)` as primary (bookers are
  contacts), reflected into `consents(member,'sms')` when a member mapping exists. *(Recommended.)*
  Alternative: require a member mapping first (blocks SMS for contact-only bookers).
- **D-P5-2 — Which events get SMS:** all four (confirmation/reminder/rescheduled/cancellation), or a
  subset (e.g. reminder-only to start). *(Recommend all four, all consent-gated.)*
- **D-P5-3 — TRAIGA disclosure:** confirm whether the transactional booking SMS templates must carry
  a TRAIGA AI-disclosure line (they are human-authored approved templates).
- **D-P5-4 — Reschedule notice copy:** confirm the dedicated `appointment-rescheduled` template
  content/tone (distinct from confirmation) before wiring the reclassification.

## 6. Guardrails reaffirmed

One gate (`evaluateGate`), extended not bypassed. SMS off by default behind a flag. Consent explicit
+ never inferred + instantly revocable (STOP). Quiet hours are the non-negotiable TCPA floor. Blocked
sends are logged + escalated, never silently dropped. `personalize.ts`/`notify.ts` rendering is
untouched (P5.0). Every send-path slice is reviewed as a diff before commit.
