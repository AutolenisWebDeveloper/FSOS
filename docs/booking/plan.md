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

## Slice 3 — Public booking flow
Public route at `/schedule` (already allowlisted, no page yet). Timezone-correct slot picker rendering in
the booker's zone; name/email/phone; **atomic slot claim** (DB unique index → clean "just taken" on race);
resolve/create a spine `contact` (never a parallel person record); write the appointment; log `activity`;
capture booking consent. Honor the `is_security` firewall; no sensitive data in the form. Repoint
`bookingUrl()` → `/schedule`. Design bar per §2.A (mobile-first, WCAG 2.2 AA, designed empty/error/no-slots).

## Slice 4 — Zoom meeting provisioning
Add meeting creation to `src/lib/zoom/client.ts` (reuse S2S OAuth, `zoomEnabled()` gate). On a `video`
booking, auto-create the meeting; store `zoom_meeting_id/join_url/start_url/dial_in`. Client gets
`join_url` only; `start_url` is FSA-only, never sent/logged. Unconfigured Zoom → `not_configured`, booking
still succeeds. `phone`/`in_person` skip Zoom.

## Slice 5 — Notifications through comms
Confirmation on booking; reminders (configurable lead, e.g. 24h + 1h) via `sendThroughGate()` — never
direct Twilio/Resend, no comms-code edits. Reminders on the existing cron/job path, idempotent
(`reminder_sent_at`). Reuse `src/emails/appointments.tsx`.

## Slice 6 — Reschedule / cancel
Signed, expiring, single-purpose tokens in the confirmation. Cancel frees the slot atomically, deletes the
Zoom meeting, notifies. Reschedule claims-new-and-frees-old in one transaction and updates the Zoom time.
All transitions audited; Zoom-unconfigured steps are clean no-ops.

## Slice 7 — Google busy-sync (one-way, optional)
Read-only Google Calendar busy blocks feed the calculator's `externalBusy`. OAuth (read-only scope), tokens
encrypted at rest, refresh server-side. One-way only. `not_configured`-safe; token expiry/revocation/downtime
degrade to native availability (WARNING, not ERROR).

## Slice 8 — Calendly decommission
Migrate open Calendly bookings onto the spine (reconciliation count). Remove the webhook + references
(`forms.ts`, `dashboard/route.ts`, `health/route.ts`, legacy command-center). Network-proof no `calendly.com`
/ `CALENDLY_*` remain. Then the user cancels the subscription manually.

## Cross-cutting Definition of Done (every slice)
Real data (no mocks); Zod at the edge; server-side authz + RLS; full loading/empty/error/success states;
WCAG 2.2 AA; audit on book/reschedule/cancel/no-show; guardrails intact; `npm run build`, `type-check`,
`lint`, `npm test`, RLS proof all green; integration-map surfaces verified; docs + ADR-027 kept in sync.
