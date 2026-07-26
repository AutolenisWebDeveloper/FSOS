# Native Booking — Current-State Note (pre-implementation)

_Discovery output for the "replace Calendly with native FSOS booking" initiative. Point-in-time
audit of the code as it exists before Slice 1. Verify against the live repo before relying on any line reference._

## The core problem: two disconnected appointment models

**Model A — native `appointments` table (household-keyed).** Columns (mig 009 + 048):
`id, household_id, review_id, scheduled_at, status, external_ref, opportunity_id, created_at, updated_at`.
Status enum: `scheduled | completed | cancelled | no_show`. This is the internal system of record and
the only model every FSA/client/revenue surface reads. **The only code path that inserts into it today
is the review-scheduling flow** (`src/app/api/reviews/route.ts` → insert on a scheduled review).

**Model B — legacy activity feed (customer-keyed).** Rows in `activity` with `type='appointment'`, keyed on
`customer_id`, written **only** by the Calendly webhook and read **only** by one legacy dashboard endpoint
(`/api/dashboard?scope=calendar`, which no App-Router page consumes). A Calendly booking lands here and is
**invisible** to the FSA calendar, client portal, revenue funnel, and comms claim-resolver.

Native booking closes this gap: every booking becomes a native `appointments` row on the spine, so all
surfaces see it, and Model B / Calendly is decommissioned (Slice 8).

## The minimal `appointments` table

Before Slice 1 the table has no duration, timezone, appointment type, attendee contact, booking token,
meeting mode, or Zoom fields. Slice 1 extends it additively (mig 069) — it is **not** replaced by a
parallel bookings table.

## Existing infrastructure to reuse (do not rebuild)

| Concern | Reuse | Notes |
|---|---|---|
| Zoom | `src/lib/zoom/client.ts` (`zoomEnabled()`, `addZoomRegistrant`) | Registrant-add exists; **meeting creation** is not yet exposed and is Slice 4's addition to this client. S2S OAuth already configured; graceful no-op when unset. |
| Comms | `src/lib/comms/send.ts` `sendThroughGate()` | Confirmations/reminders route here. 7-step gate at send time. **Do not modify comms.** |
| Server reads | `src/lib/data/query.ts` `load()` (FSA surfaces) / `getDb()` + `src/lib/portal/allowlist.ts` (portal surfaces) | Two conventions; match the surface. |
| Lifecycle | `src/lib/appointments/recovery.ts` (pure) + `service.ts` | State machine, overdue, funnel, no-show recovery already exist. Booking feeds these. |
| Emails | `src/emails/appointments.tsx` (`AppointmentConfirmation`, `AppointmentReminderEmail`, `AppointmentRecap`, `RescheduleInvite`) | Templates already registered under `category:'appointment'`. |
| Public route | middleware allowlist (`src/lib/auth/rbac.ts`) | `/schedule` + `/schedule/success` are **already allowlisted with no page files** — the reserved home for the public booking flow (Slice 3), zero RBAC change. |
| Public "Book" CTA | `src/lib/site.ts` `bookingUrl()` | Currently returns `NEXT_PUBLIC_CALENDLY_URL || '/#contact'`. Repointing this to `/schedule` swings the whole public site + header onto native booking. |

## Conventions locked in

- Migrations: additive, idempotent, forward-only; next number is **069** (highest applied is 068).
- Pure domain cores live in `src/lib/**`, are DB-free, and are unit-proven by compiling in isolation
  (`tsc --outDir …`) — see `tests/appointment-recovery.test.mjs` for the pattern.
- New data tables: RLS enabled, **default-deny** (service-role writes; reads server-side after an rbac
  assertion), matching `appointments` (mig 010). No explicit SELECT policy = service-role only.
- Every table gets `update_updated_at()` trigger + purposeful indexes; no raw SQL in PostgREST `.select()`.

## Guardrails in play

- **Securities firewall (§4.1):** booking stores only scheduling metadata + a spine link — no securities
  data. `is_security` records stay out of the automated comms path (enforced by the existing gate).
- **AI red-line (§4.2):** booking is deterministic; no AI writes appointments.
- **TCPA/quiet-hours/consent (§12):** all reminders go through the comms gate, which re-checks at send time.
- **Zoom `start_url` is FSA-only** — never sent to the client or logged; only `join_url` is client-facing.
