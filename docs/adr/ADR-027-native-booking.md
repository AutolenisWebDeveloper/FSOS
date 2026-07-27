# ADR-027 — Native FSOS Booking (Calendly replacement)

**Status:** Accepted
**Date:** 2026-07-26
**Owner:** FSOS Engineering

## Context

FSOS depends on Calendly for client self-scheduling. Calendly bookings land in the **legacy**
`customers`/`activity` model via a webhook and never reach the aggregate-root spine, so a booked
appointment is invisible to the FSA calendar, client portal, revenue funnel, and the comms
claim-resolver (see `docs/booking/current-state.md`). The dependency is also a recurring cost and a
third party holding client scheduling data. We are replacing it with a native, spine-attached booking
system: client self-scheduling → confirmation/reminders through the existing comms platform →
reschedule/cancel → optional one-way Google busy-sync → Calendly decommission.

Constraints: this is an in-place extension of a production, regulated system. The securities firewall
(§4.1), AI red-line (§4.2), and communications compliance (§12) all apply. Existing appointment
surfaces, the Zoom integration, and the comms dispatcher must be **reused, not rebuilt**.

## Decision

1. **Extend `appointments`, do not fork it.** Native bookings are rows in the existing `appointments`
   table (mig 069 adds type/contact/host/timezone/`starts_at`/`ends_at`/tokens/meeting-mode/Zoom
   columns). Native bookings keep `scheduled_at == starts_at` for backward-compatibility so every
   surface that already reads `scheduled_at` works unchanged. Manual, native, and migrated-Calendly
   appointments carry a `booked_via` provenance flag but behave identically everywhere.

2. **Availability is a pure, deterministic calculator.** `src/lib/booking/availability.ts` computes
   bookable slots = weekly availability rules − existing appointments (± buffers) − blackouts −
   external busy − outside `[now+minNotice, now+maxLeadDays]` − days at `max_per_day`, rendered in the
   booker's timezone. It is DB-free and unit-proven offline, including DST boundaries. All timezone
   math goes through `src/lib/booking/timezone.ts`, an `Intl`-backed (no new dependency) DST-correct
   helper; every instant is stored as `timestamptz` (UTC) and reasoned about in UTC.

3. **Double-booking is prevented at the database, not by check-then-insert.** A partial unique index
   `uq_appointments_host_slot` on `(host_user_id, starts_at) WHERE status='scheduled'` guarantees at
   most one confirmed appointment per host per slot-start. Two concurrent confirmations of the same
   slot → exactly one INSERT wins; the loser gets a unique violation the booking service turns into a
   clean "slot just taken." Cancelling frees the slot (status → cancelled leaves the partial index);
   rescheduling updates `starts_at` — both atomic in one transaction.

4. **Notifications route through `lib/comms`, unchanged.** Confirmations and reminders send via
   `sendThroughGate()` — the existing 7-step compliance gate re-checked at send time — never a direct
   Twilio/Resend call. Reminders are idempotent (`reminder_sent_at`) and run on the existing cron/job
   path. Comms code is **consumed, never modified**.

5. **Video appointments reuse the existing Zoom client.** Meeting provisioning is added to
   `src/lib/zoom/client.ts` (the same client workshops use) and gated on `zoomEnabled()`; unconfigured
   Zoom degrades to a `not_configured` state, never a hard failure. The client receives only `join_url`;
   `start_url` is FSA-only and never sent or logged.

6. **Self-service via signed tokens.** Reschedule/cancel links carry signed, expiring, single-purpose
   tokens that expose no IDs.

7. **Google busy-sync is one-way and optional.** FSOS reads the FSA's Google busy blocks so the
   calculator subtracts real commitments; it never writes bookings back to Google in this initiative.
   Tokens encrypted at rest; `not_configured`-safe.

8. **Calendly is decommissioned last.** After native booking works end to end, open Calendly bookings
   are migrated onto the spine, the webhook + references are removed, network-proven gone, and the
   subscription is cancelled manually. *(Implemented in Slice 8: reconciliation is an idempotent,
   forward-only migration — mig 073 — that lifts still-open Calendly bookings from the legacy `activity`
   feed onto the `appointments` spine as `booked_via='legacy_calendly'`, bridged via
   `households.legacy_customer_id`, deduped by `external_ref='calendly:<id>'`, with a durable count in
   `audit_log`; the inbound webhook is deleted and the legacy Model-B `?scope=calendar` dashboard read is
   repointed to the native spine. The frozen GHL webhook's appointment handling is untouched.)*

## Rationale

Extending the spine table (not a parallel `bookings` table) is what makes every existing surface see
native bookings for free and preserves the aggregate-root architecture (§6). A DB-level uniqueness
guarantee is the only correct answer to concurrent booking — an availability check followed by an
insert races. A pure calculator with `Intl` timezone math keeps the hardest logic (DST, buffers,
capacity) unit-testable with zero infrastructure and no new dependency. Reusing the comms gate and Zoom
client honors the "one dispatcher, one integration" rule and keeps every outbound message inside the
compliance firewall.

## Alternatives Considered

- **Parallel `bookings` table.** Rejected: fragments the appointment model, forces every surface to
  read two sources, and violates §6. The whole point is one spine.
- **Application-level double-booking check.** Rejected: check-then-insert races under concurrency;
  §1.2 requires a database guarantee.
- **`date-fns-tz` / a timezone library.** Rejected for the core: `Intl` already carries the full IANA
  DST database and needs no install, keeping the pure calculator dependency-free and offline-testable.
- **Two-way Google Calendar write-back.** Deferred: it is the expensive, failure-prone part and is out
  of scope here. One-way busy-read delivers the correctness benefit (no overlap with real commitments)
  at a fraction of the risk.
- **A new notification path for booking.** Rejected: would duplicate the dispatcher and bypass the
  compliance gate. Booking consumes `lib/comms`.

## Consequences

**Positive**
- Every booking is a first-class spine row visible to all appointment surfaces immediately.
- Double-booking is structurally impossible, proven by a concurrent-insert test.
- Timezone/DST correctness is unit-proven offline; no naive-timestamp math.
- No new dependency for the availability core; comms and Zoom integrations reused, not cloned.
- Calendly (a paid third party holding client data) is removed.

**Negative / trade-offs**
- `scheduled_at`/`starts_at` are dual-maintained on native rows (documented invariant) until legacy
  surfaces migrate fully to `starts_at`.
- `host_user_id` is a bare uuid (matching existing `owner_scope`/`holder_user_id` conventions), not a
  hard FK to `auth.users`; the double-booking index exempts legacy rows with a null host.
- One-way busy-sync means FSOS bookings are not pushed to Google in this initiative (deliberate scope
  cut; a future ADR can add write-back).

## Related Documents
- CLAUDE.md §1, §4.1, §4.2, §6, §10, §12, §13
- `docs/booking/current-state.md`, `docs/booking/integration-map.md`, `docs/booking/plan.md`
- `docs/adr/ADR-003-communications-dispatcher.md` (comms gate reused)
- `docs/adr/ADR-004-securities-firewall.md`, `docs/adr/ADR-001-aggregate-root.md`
- Migration `supabase/migrations/069_native_booking_availability.sql`
