# Native Booking — Phased Plan

Vertical slices, one reviewed draft PR each, in order. **Do not start the next slice until the current
one is merged.** Authority: this plan defers to `CLAUDE.md` + `/docs` → `DESIGN.md` → ADR-027 → live repo.

## Slice 1 — Availability model + rules engine ✅ (this PR)
Additive schema (mig 069) + the pure availability calculator. No public UI.
- Extend `appointments` (type/contact/host/timezone/`starts_at`/`ends_at`/tokens/meeting-mode/Zoom).
- New tables: `appointment_types`, `availability_rules`, `availability_blackouts` (RLS default-deny).
- DB-level double-booking guarantee: partial unique index on `(host_user_id, starts_at) WHERE status='scheduled'`.
- `src/lib/booking/timezone.ts` (Intl, DST-correct) + `src/lib/booking/availability.ts` (pure calculator).
- `tests/booking-availability.test.mjs` — DST, buffers, min-notice/max-lead/max-per-day, blackout/external, exact-slot removal.

## Slice 2 — Appointment types + FSA configuration UI ✅
FSA sets appointment types, weekly hours, buffers, blackouts, min-notice, max lead at `/app/booking`
(reached from the Calendar area + FSA nav). Reuses `SettingsShell`/`SettingsSection`/`Field`/`Table`/
tokens — no new design pattern. Zod at the edge (`config-schemas.ts`), thin routes → service (`config.ts`),
audit (`config.changed`) on every write, RLS default-deny.
- Services: `src/lib/booking/config.ts` + `config-schemas.ts` + `display.ts` + `route-helpers.ts`.
- Routes: `/api/app/booking/{types,rules,blackouts}` (+ `[id]` PATCH/DELETE), `requireApiRole('fsa')` + `requirePermission`.
- UI: `src/app/(fsa)/app/booking/page.tsx` + `AppointmentTypesManager` / `AvailabilityRulesManager` / `BlackoutsManager` islands.
- Tests: `tests/booking-config.test.mjs` (12 assertions — schema contracts + cross-field rules).

## Slice 3 — Public booking flow ✅
Public `/schedule` (kept under the already-allowlisted exact path via `?type=<slug>`; no auth change).
Timezone-correct slot picker rendering in the booker's detected zone; name/email/phone/notes form;
**atomic slot claim** (DB unique index → clean "just taken" on race); resolve-or-create a spine `contact`
(dedupe on email/phone via the existing resolution engine — never a parallel person record); write the
appointment on the spine (`booked_via='native'`, `scheduled_at==starts_at`); log `activities`; capture
email booking-consent intent + audit. Honors the `is_security` firewall (no sensitive fields collected).
`bookingUrl()` repointed → `/schedule`; client & partner schedule stubs now link to it.
- Services: `slots.ts` (assemble config+busy → pure calculator), `book.ts` (validate slot, resolve contact,
  atomic insert, activity+consent+audit), `ics.ts` (pure add-to-calendar).
- API: `GET /api/public/booking/availability` + `POST /api/public/booking` (honeypot + rate-limit + Zod).
- UI: `src/app/schedule/page.tsx` (type chooser) + `BookingFlow` client island (picker → details → success,
  mobile-first, WCAG-labelled, designed loading/empty/no-slots/error/success states, add-to-calendar).
- Tests: `booking-ics.test.mjs` (5), `booking-double-booking.test.mjs` (5, real Postgres — concurrent claim).

## Slice 4 — Zoom meeting provisioning ✅
`createZoomMeeting()` added to `src/lib/zoom/client.ts` (reuses the same S2S OAuth + `zoomEnabled()` gate —
no new integration/env). On a `video` booking, `book.ts` auto-creates the meeting and stores
`zoom_meeting_id/join_url/start_url/dial_in`; the confirmation carries the **join link + a `meetingStatus`**
(`provisioned`/`pending`/`none`) and the success screen shows a "Join video meeting" button when ready.
`start_url` is persisted (FSA-only) but **never returned to the client or logged** (source-scan guardrail).
Unconfigured Zoom or an API failure → booking still succeeds, link left null for retry via
`POST /api/app/booking/provision-zoom` (FSA sweep, mirrors the workshop retry). `phone`/`in_person` skip Zoom.
- Tests: `zoom-meeting-create.test.mjs` (3 — disabled no-op, no network), `booking-starturl-firewall.test.mjs`
  (6 — host link stored, never on the confirmation / in logs / in responses / in the public UI).
- Deferred (noted): the created meeting lives on the FSA's own Zoom account (appears in their Zoom app), so
  surfacing `start_url` inside FSOS is a convenience left to a later slice, not a blocker.

## Slice 5 — Notifications through comms ✅
Confirmation on booking + a single pre-appointment reminder (configurable lead, default 24h) via
`sendThroughGate()` — never direct Twilio/Resend, **comms code untouched**. Reminders on the existing
static cron path, idempotent via the `reminder_sent_at` atomic claim.
- `src/lib/booking/notify-core.ts` (pure: time formatting, meeting-details copy, `isReminderDue`) +
  `notify.ts` (`sendBookingConfirmation`, `runBookingReminderPass` — loads the approved appointment
  template by `source_key`, sends email with `durableConsentGranted` for the non-member booker + merge
  tokens carrying the time + Zoom join link; defers cleanly if the template isn't approved yet).
- Extended `src/emails/appointments.tsx` confirmation + reminder with `{{appointment_time}}` /
  `{{meeting_details}}` merge tokens (grounded at send; determinism test still green).
- `/api/cron/booking-reminders` static route (mirrors `workshop-reminders` auth) + `vercel.json` entry
  (`*/15 * * * *`); confirmation fired best-effort from the booking flow.
- Consent: reads the Slice 3 `consent_intent` (email only; never infers SMS). Quiet-hours/DNC/approval
  all still enforced by the untouched gate.
- Tests: `booking-notify.test.mjs` (15, pure) + `booking-reminder-idempotency.test.mjs` (3, real
  Postgres — the `reminder_sent_at` atomic claim sends once).

## Slice 6 — Reschedule / cancel ✅
Signed, expiring, single-purpose manage tokens carried in the confirmation/reminder emails; a public
token-gated flow at `/schedule?manage=<token>` (no id exposed). Cancel frees the slot atomically + deletes
the Zoom meeting + sends a cancellation notice; reschedule re-validates the new slot, MOVES the row in one
UPDATE (claim-new-and-free-old, guarded by the double-booking unique index), updates the Zoom time, and
re-sends the confirmation. All transitions audited; Zoom steps are gated no-ops when unconfigured.
- `src/lib/booking/manage-tokens.ts` (HMAC envelope over the STORED opaque `cancel_token`/`reschedule_token`
  + purpose + expiry — no db id in the link) + `manage.ts` (`resolveManageToken`/`cancelAppointment`/
  `rescheduleAppointment`, reusing `setAppointmentStatus`, `computeSlotsForType`, Zoom update/delete, notify).
- `GET/POST /api/public/booking/manage` (token-gated, rate-limited, purpose must match action) +
  `ManageFlow` client (`/schedule?manage=`), reusing the availability API for the reschedule picker.
- New `AppointmentCancellation` email template (registry 30→31; determinism test updated); confirmation +
  reminder now carry `{{reschedule_url}}`/`{{cancel_url}}` signed manage links.
- Tests: `booking-manage-token.test.mjs` (10, pure — sign/verify/expiry/tamper/single-purpose) +
  `booking-reschedule-move.test.mjs` (2, real Postgres — atomic move rejects a taken slot, frees the old).

## Slice 7 — Google busy-sync (one-way, optional) ✅
Read-only Google Calendar busy blocks feed the calculator's `externalBusy`. OAuth (`calendar.readonly` scope
ONLY), tokens encrypted at rest, refresh server-side. One-way only — FSOS never writes to Google.
`not_configured`-safe; token expiry/revocation/downtime/timeout all degrade to native availability
(`skipped`, WARNING not ERROR) — the booker always sees native slots.
- New table (mig 072) `booking_calendar_connections`, scoped by nullable `host_user_id` (null = default host),
  one active per host (partial unique indexes), default-deny RLS. Credential envelope encrypted at rest via
  pgcrypto SECURITY DEFINER RPCs (`booking_calendar_set_secret`/`_secret`, env-held key, revoked from
  anon/authenticated) — booking-local, conforming to the social secret-at-rest technique without touching the
  frozen social module (§6 bounded contexts).
- `src/lib/booking/google/oauth.ts` (PURE: provider config + gate, authorize URL, signed expiring CSRF state,
  credential envelope, `mapFreeBusyResponse` RFC3339→UTC-ISO) + `exchange.ts` (server-only: code exchange,
  silent refresh, `freeBusy` read — raw `fetch`, no `googleapis` dep) + `connection.ts` (DB service, never
  selects `secret_enc`) + `busy.ts` (`loadGoogleBusy` — the degrade-safe, never-throws orchestrator).
- Wired at the single Slice-3 seam (`slots.ts` `externalBusy`), loaded over the same ±1-day padded window as
  existing appointments; subtracted raw (no buffer) by the calculator.
- Routes: `GET/DELETE /api/app/booking/calendar` (status/disconnect) + `GET .../calendar/oauth/{start,callback}`
  (FSA-guarded, signed-state + nonce-cookie double binding, redirect flow). FSA connect card added to
  `/app/booking` (`GoogleCalendarConnect`), reusing `SettingsSection`/`Badge`/`Button` — no new design pattern.
- Tests: `booking-google-oauth.test.mjs` (11, pure — read-only scope, offline consent, state sign/verify/expiry/
  tamper/cross-kind, envelope, freeBusy mapping) + `booking-google-no-writeback.test.mjs` (5, source scan —
  only `calendar.readonly` + only `freeBusy`, no events-mutation endpoint) + `booking-google-connection.test.mjs`
  (6, real Postgres — pgcrypto encrypt-at-rest round-trip + wrong-key failure, per-host uniqueness, disconnect).

## Slice 8 — Calendly decommission ✅
Third-party scheduler removed; booking is fully native.
- **Reconciliation (mig 073):** forward-only + idempotent. Lifts still-OPEN Calendly bookings (future,
  non-cancelled, ISO-parseable) from the legacy `activity` feed onto the spine as
  `booked_via='legacy_calendly'` `appointments`, linked to the household via
  `households.legacy_customer_id` (null host/household when unbridged — never dropped), `scheduled_at`
  in lock-step with `starts_at`, deduped by `external_ref='calendly:<activity_id>'`; records a durable
  count in `audit_log`. Past/cancelled/unparseable rows are skipped (§4.3).
- **Removed:** the inbound webhook (`/api/webhooks/calendly`), its `forms.ts` comment coupling,
  `health/route.ts` `calendly_secret`, and the legacy command-center Calendly copy + integration row.
- **Retired Model B:** `dashboard/route.ts` `?scope=calendar` now reads the native `appointments` spine
  (upcoming scheduled) instead of the Calendly activity feed, and `counts.appointments` is a real count
  (was hardcoded `0`). The workshop-replay CTA + all "Book" CTAs resolve through `bookingUrl()` → `/schedule`.
- **Env:** `CALENDLY_*` removed from `.env.local.example` (replaced with the optional Google Calendar
  busy-sync vars from Slice 7).
- **Tests:** `booking-calendly-gone.test.mjs` (5, source scan — no `calendly.com`/`CALENDLY_*`/webhook
  route remain, `bookingUrl()`→`/schedule`) + `booking-calendly-reconcile.test.mjs` (7, real Postgres —
  only open bookings migrate, household bridge, idempotency, audit count, skip past/cancelled/unparseable).
- **Untouched:** the frozen GHL webhook's appointment handling. After this merges, the FSA cancels the
  Calendly subscription manually.

## Cross-cutting Definition of Done (every slice)
Real data (no mocks); Zod at the edge; server-side authz + RLS; full loading/empty/error/success states;
WCAG 2.2 AA; audit on book/reschedule/cancel/no-show; guardrails intact; `npm run build`, `type-check`,
`lint`, `npm test`, RLS proof all green; integration-map surfaces verified; docs + ADR-027 kept in sync.
