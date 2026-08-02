# Booking Modernization — P0 Evidence Report

> **Phase:** P0 (Preflight & Shared Defect Coordination)
> **Branch:** `claude/fsos-booking-modernization-4naanx`
> **Base:** HEAD `ca734c0` (email-templates-redesign merge chain) — a clean starting point; **no
> booking-modernization commits exist yet** on this branch.
> **Date of audit:** 2026-08-02
> **Posture:** Scoped autonomy ("god mode"). Production Supabase writes, `apply_migration`,
> `execute_sql`, `deploy_edge_function`, live SMS/email, branch merge/reset/delete, `git push`,
> PR/merge, and production deploy remain **denied**. Commit-to-branch is permitted.

This report is evidence-based. Every capability claim below is backed by a `file:line` or
migration citation gathered by direct code reading during P0. It is the authoritative input to the
P1 plan (`docs/booking/P1-plan.md`).

---

## 0. Environment & operating-mode notes

- **`.claude/settings.local.json` is ABSENT** (it is per-developer and gitignored; it will not
  exist in a fresh clone). Per the program's operating mode we do **not** hard-stop: we proceed
  under read / edit / build / test with the standing denials enforced by both policy and the fact
  that the Supabase and Twilio MCP servers are unauthenticated in this environment (migrations and
  live sends are independently impossible here).
- Dependencies were installed locally (`npm install`, exit 0) solely to run the baseline commands.

---

## 1. Baseline command results (§6.3)

Enumerated from `package.json` `scripts` — **no command names were invented.** All run against the
clean base branch before any change.

| Command | Script | Result | Notes |
|---|---|---|---|
| Type check | `npm run type-check` (`tsc --noEmit`) | ✅ **exit 0** | clean |
| Lint | `npm run lint` (`next lint`) | ✅ **exit 0** | "No ESLint warnings or errors" |
| Unit tests | `npm test` (`run-tests.mjs unit`) | ✅ **exit 0** | **123 unit test files passed** |
| RLS tests | `npm run test:rls` (`run-tests.mjs rls`) | ✅ **exit 0** | **8 RLS test files, 33+ firewall assertions passed** |
| Production build | `npm run build` (`next build`) | ✅ **exit 0** | full route + middleware build succeeded |

**There are no pre-existing baseline failures.** Therefore any failure introduced by later phases
is attributable to that phase — the baseline is a clean reference.

---

## 2. Section 3 shared-render coordination — **STATE (a)**

**Determination: the shared render-engine fix IS present on this program's base branch. Reuse it;
do not re-implement. The booking-email defect is RESOLVED. The Section 3 dependency that gates P5
send work is satisfied.**

### Evidence

- The fix is commit **`a380269` — "fix(comms): fail-closed shared render engine + wire
  booking/campaign identity (D1–D4)"**. `git merge-base --is-ancestor a380269 HEAD` → **true**
  (it is an ancestor of this branch's HEAD). It is **not** on `origin/main` (which is behind this
  branch), which is why the program brief anticipated State (b) "not on main." The controlling
  test per Section 3 is *"present on this program's base branch,"* and it is — so **State (a)
  applies**, not (b).
- **Root cause it fixed:** `personalize()` previously substituted only a fixed ~10-key allowlist
  and blanked every other `{{token}}`, silently dropping `notify.ts`'s correctly-computed
  `appointment_time` / `meeting_details` / `reschedule_url` / `cancel_url` — shipping confirmation/
  reminder emails with an empty "When:" line and a broken "Reschedule: — or cancel:" sentence, plus
  CAN-SPAM-exposing relative unsubscribe/scheduling links.
- **The fix, verified in the live tree** (`src/lib/comms/personalize.ts`):
  - `personalize()` now substitutes **every key present in the context**, not a fixed allowlist
    (`personalize.ts:140-145`).
  - Two token tiers: **cosmetic** (`first_name`, `greeting`, …) keep a safe neutral default;
    **blocking** tokens — advisor + agency identity, `unsubscribe_url`, `scheduling_link`, and the
    four booking specifics `appointment_time` / `meeting_details` / `reschedule_url` / `cancel_url`
    — must resolve or the send is hard-blocked (`BLOCKING_TOKENS`, `personalize.ts:78-89`).
  - `unresolvedBlockingTokens()` reports referenced-but-unresolved blocking tokens and **requires
    URL tokens to be ABSOLUTE** (`URL_TOKENS`, `isAbsoluteUrl`, `personalize.ts:92,113-115,153-170`).
  - Never emits a raw `{{token}}` or a misleading empty value for a blocking token.
- **The booking path already supplies those tokens end-to-end** (`src/lib/booking/notify.ts`,
  `notify-core.ts`):
  - `buildBookingContext()` computes `appointment_time` (DST-correct `Intl.DateTimeFormat`,
    `notify-core.ts:12-39,78-100`) and `meeting_details` (`notify-core.ts:54-68`).
  - `manageUrls()` builds **absolute** signed `reschedule_url` / `cancel_url` from `siteUrl()`
    (`notify.ts:65-77`) and injects them into `recipientContext` (`notify.ts:135`).

### Consequence for later phases

- **Booking-email defect (D1–D4): RESOLVED on base by campaign work.** Do **not** author a
  booking-only rendering fix; do **not** modify `personalize.ts` or `notify.ts` for rendering.
- **P5 send-path dependency: satisfied.** Lifecycle templates render booking data correctly, so P5
  is unblocked from the Section-3 standpoint (P5 remains a later phase with its own gates, esp.
  Twilio A2P/consent and the feature-flag rollout).
- **P1 (public UI) does not touch `personalize.ts`/`notify.ts` at all** and proceeds regardless.

---

## 3. Verified existing booking backend (§6.2) — preserve, do not rebuild

All **VERIFIED** by direct reading unless marked otherwise.

### 3.1 Availability & slot calculation — VERIFIED, DST-correct
- Pure calculator `computeAvailableSlots()` (`src/lib/booking/availability.ts:117-208`); DB
  assembler `src/lib/booking/slots.ts`; Intl-backed TZ math `src/lib/booking/timezone.ts`.
- **DST is Intl-aware, not naive offset math.** `zonedTimeToUtc()` is two-pass — it recomputes the
  zone offset at the resulting instant and corrects across spring-forward/fall-back
  (`timezone.ts:36-50`); offsets come from `Intl.DateTimeFormat` parts (`timezone.ts:20-25`), so
  CDT/CST derive from the IANA DB, not a stored constant.
- `availability_rules` matched by weekday + `active` + effective-date window
  (`availability.ts:169-172`, `slots.ts:71-74`); `availability_blackouts` subtracted **raw**
  (`availability.ts:146-149,199`); buffers widen existing appointments (`availability.ts:140-145`);
  min-notice / max-lead / per-day capacity all enforced (`availability.ts:194-203`).

### 3.2 Double-booking prevention — VERIFIED (DB-enforced, partial unique index)
```sql
-- supabase/migrations/069_native_booking_availability.sql:154-156
create unique index if not exists uq_appointments_host_slot
  on appointments (host_user_id, starts_at)
  where status = 'scheduled' and host_user_id is not null and starts_at is not null;
```
- Only `status='scheduled'` rows participate → cancel frees the slot. Guard is **exact
  `(host, starts_at)` equality**; there is **no** range/overlap `EXCLUDE` constraint — overlap
  prevention for differing start instants relies on the app-layer buffer math (see §6, item D3).

### 3.3 Atomic create / reschedule / cancel
- **Create — VERIFIED atomic** (conflict-guarded insert). `bookAppointment()` re-validates the slot
  live (`book.ts:84-101`), then a single guarded `INSERT ... status:'scheduled'`; a stale-slot race
  raises Postgres `23505`, caught and returned as `{ kind:'taken' }` (`book.ts:117-144`). All
  post-insert work (Zoom, activities, audit, notifications) is best-effort and cannot fail the
  booking (`book.ts:148-298`).
- **Reschedule — VERIFIED atomic + state-checked.** Single conditional
  `UPDATE ... WHERE id=? AND status='scheduled'` (`manage.ts:139-150`); `23505` → `taken`; empty
  result → `not_reschedulable`.
- **Cancel — PARTIAL (see §6, item D1).** `cancelAppointment()` delegates to `setAppointmentStatus`
  which does SELECT-status → `canTransition` check → UPDATE filtered on `id` **only** (no
  `.eq('status', from)` guard) — `src/lib/appointments/service.ts:33-69`. A TOCTOU window exists.
  Low practical impact (cancel only frees a slot; cannot double-book), but it is not as atomic as
  reschedule. **Documented for human approval before any behavior change (Binding Rule 7).**

### 3.4 Signed management tokens — VERIFIED
- `signManageToken` builds a base64url `{ t: opaqueToken, p: purpose, exp }` envelope + HMAC-SHA256
  (`manage-tokens.ts:30-36`); `verifyManageToken` recomputes HMAC with `crypto.timingSafeEqual`,
  validates purpose ∈ {cancel,reschedule} and expiry (`manage-tokens.ts:39-61`). **TTL = 120 days**
  (`manage-tokens.ts:64`). The envelope carries the stored opaque `cancel_token`/`reschedule_token`
  (144-bit random, mig 069), never the appointment UUID → no enumeration.
- ⚠️ **Key fallback risk (see §6, item D2):** `manageTokenKey()` last-resort fallback is a
  **hardcoded literal** dev key (`manage-tokens.ts:26`); a production misconfig (no
  `BOOKING_TOKEN_KEY`/`FSOS_API_SECRET`/`SOCIAL_TOKEN_KEY`) would allow token forgery. Config
  hardening, documented for human review.

### 3.5 Status model — VERIFIED (no approval lifecycle)
```sql
-- supabase/migrations/009_aggregate_root_core.sql:441
status text not null default 'scheduled'
  check (status in ('scheduled','completed','cancelled','no_show')),
```
- Enum is **exactly** `scheduled/completed/cancelled/no_show`, default `scheduled`, **NO
  pending/approved/declined/reconfirmation state.** Migrations 048 & 069 add columns/indexes only.
  State machine mirrored in `src/lib/appointments/recovery.ts:21,36-41`.
- Key columns (mig 069): `reminder_sent_at`, `cancel_token`, `reschedule_token`, `booking_token`
  (each partial-unique), `booker_timezone`, `join_url` (client-facing), `start_url` (FSA-only,
  never sent/logged), `dial_in`, `meeting_mode` (`video|phone|in_person`), `host_user_id`,
  `duration_minutes`, `booked_at`, `booked_via` (`native|manual|legacy_calendly`), `zoom_meeting_id`,
  `appointment_type_id` + `contact_id` FKs. `opportunity_id` was added in mig 048 but is **not**
  populated by the public booking path.

### 3.6 Google Calendar — VERIFIED (read-only, degrade-safe)
- Single scope `calendar.readonly` (`google/oauth.ts:25,66`) — no write scope anywhere. HMAC-signed
  expiring `state` bound to an httpOnly nonce cookie (`oauth.ts:102-138`). `loadGoogleBusy` **never
  throws and never blocks availability** — every failure returns `{ busy:[], skipped:true, reason }`
  (`google/busy.ts:6-92`). Only free/busy **time ranges** are read (no titles/attendees).
- `booking_calendar_connections` (mig 072): `secret_enc bytea` pgcrypto-encrypted via SECURITY
  DEFINER RPCs with the key passed per call (never stored); RLS default-deny; `SAFE_COLUMNS`
  excludes the secret (`google/connection.ts:33-34`).

### 3.7 Zoom — VERIFIED (S2S OAuth, credential-gated no-op)
- `src/lib/zoom/client.ts`: Server-to-Server OAuth, `zoomEnabled()` true only with all three
  `ZOOM_*` env vars; absent → clean no-op, booking still succeeds. `createZoomMeeting` returns
  `joinUrl` (client) + `startUrl` (**host-only, never returned/logged**); `update`/`delete` support
  reschedule/cancel. Retry route `POST /api/app/booking/provision-zoom` (`requireApiRole('fsa')` +
  `requirePermission`). `join_url`/`start_url`/`dial_in`/`zoom_meeting_id` stored on the appointment.

### 3.8 ICS — VERIFIED
- `src/lib/booking/ics.ts`: pure, deterministic RFC-5545 VCALENDAR; used **client-side only** in
  `BookingFlow.tsx:15,423` ("add to calendar"). Covered by `tests/booking-ics.test.mjs`.

### 3.9 Cron reminders — VERIFIED (single-interval, EMAIL-only today)
- `src/app/api/cron/booking-reminders/route.ts`: static segment, `GET`, guarded by `x-vercel-cron`
  header **or** `Authorization: Bearer ${CRON_SECRET}` (401 otherwise). Calls
  `runBookingReminderPass()` — one pre-appointment reminder within the lead window, **email only**,
  atomic `reminder_sent_at` null→now claim so overlapping ticks send at most once, claim released on
  non-send for retry (`notify.ts:199-267`). **No booking SMS exists.** This single-interval /
  email-only shape is exactly what P5 replaces (multi-interval, per-channel).

### 3.10 Config CRUD — VERIFIED (all present)
- `types` (GET/POST/PATCH/DELETE), `rules` (GET/POST/PATCH/DELETE), `blackouts` (GET/POST/DELETE) under
  `src/app/api/app/booking/**`. Every route `runtime=nodejs` + `dynamic=force-dynamic`,
  `requireApiRole('fsa')`, writes add `requirePermission([...])` and Zod `.safeParse` → 400 on
  failure, service in `config.ts`, schemas in `config-schemas.ts` (mig-069 tables).

### 3.11 Existing appointment email templates — VERIFIED
- `src/emails/appointments.tsx` exports exactly **five** components:
  `AppointmentConfirmation`, `AppointmentCancellation`, `AppointmentReminderEmail`,
  `AppointmentRecap`, `RescheduleInvite`. Mapped to `comm_templates.source_key` via
  `src/emails/registry.tsx:68-72`: `appointment-confirmation`, `appointment-cancellation`,
  `appointment-reminder-email`, `appointment-recap`, `reschedule-invite`. Built/upserted (draft) by
  `scripts/build-email-templates.ts`.

### 3.12 CRM linkage — VERIFIED (contact-only, by design)
- Appointments link to the spine **only via `contact_id`** (`069:120`). `book.ts` resolves-or-creates
  a spine `contacts` row (dedupe on email/phone, never on name; new public booker → `prospect`).
  Household is reached **indirectly** through the contact (`book.ts:205-214`). **No `household_id`,
  and no populated `opportunity_id`/`case_id`** on the public booking path — consistent with the
  securities firewall ("only scheduling metadata + a contact link are stored", `book.ts:11-12`).

---

## 4. Existing test coverage (§6.4)

- **Custom runner** `scripts/run-tests.mjs` with `unit` and `rls` modes; suites live in `./tests`.
- **Unit:** 123 files pass — includes booking coverage (`tests/booking-*.test.mjs`, e.g.
  `booking-ics`, `zoom-meeting-create`, availability/timezone logic).
- **RLS:** 8 files / 33+ firewall assertions pass.

## 5. Missing test infrastructure (§6.4) — disclosed, not assumed

Confirmed by inspecting `package.json` deps + config files:

- **No Playwright, Cypress, Puppeteer** → **no automated end-to-end / browser harness.**
- **No axe / Lighthouse automation** → **no automated accessibility or perf harness.**
- **No vitest / jest / testing-library** → the only test tooling is the bespoke Node runner above.
- **No screenshot / visual-regression harness.**

**Consequence:** for P1–P5 we will **not claim** automated e2e, accessibility, visual, or browser
results. Those checks will be performed and reported as **manual**. A bounded proposal to add a
minimal Playwright + axe harness belongs in **P4** (§10.3) as a separate, cost-scoped decision — not
folded into feature work.

---

## 6. Remaining booking-specific defects (documented, NOT fixed in P0/P1)

Per Binding Rule 7, verified business-rule/behavior defects are documented and require **explicit
human approval** before behavior changes. None of these block the P1 public-UI redesign.

| ID | Severity | Finding | Location | Handling |
|---|---|---|---|---|
| **D1** | Low | Cancel path is read-then-write (SELECT status → check → UPDATE on `id` only, no `.eq('status', from)` guard) — a TOCTOU window. Cannot double-book (only frees a slot). | `src/lib/appointments/service.ts:33-69` | Backend correctness fix; needs human approval. Out of P1 scope. |
| **D2** | Med (config) | `manageTokenKey()` last-resort fallback is a hardcoded literal dev key; a prod misconfig would allow manage-token forgery. | `src/lib/booking/manage-tokens.ts:26` | Ops/config hardening + a fail-closed check; propose separately. Out of P1 scope. |
| **D3** | Low (design) | Double-book guard is exact-equality only; no DB range/overlap `EXCLUDE`. Overlap for differing starts relies on app buffer math. | mig `069:154-156` + `availability.ts:140-145` | Design characteristic, not a P1 blocker. Note for a future DB hardening ADR. |
| **P5-scope** | n/a | Single-interval, email-only reminders; no booking SMS. | `notify.ts` / cron | **Expected** — this is the deliverable of P5, not a defect. |

**No booking-specific rendering/identity defect remains** — D1–D4 from the program brief were the
render-engine bug, resolved on base (§2).

---

## 7. P1 boundary (§6.5) — the public `/schedule` redesign

P1 is **public-UI-only over the existing public booking APIs.** It builds on the **PublicShell**
primitives + **globals.css tokens** (NOT `SiteShell`/`marketing.css`, which are the separate
marketing chrome). The full plan is in `docs/booking/P1-plan.md`.

### 7.1 Files P1 MAY modify (presentation only)
1. `src/app/schedule/page.tsx` — route shell, metadata, type chooser, branch wiring.
2. `src/components/public/booking/BookingFlow.tsx` — the booking wizard UI/UX.
3. `src/components/public/booking/ManageFlow.tsx` — manage / cancel / reschedule UI.
4. **New** files under `src/components/public/booking/**` — extracted sub-components (hero, stepper,
   calendar, type cards, review, confirmation), **extending — not forking — BookingFlow/ManageFlow.**
5. `src/lib/booking/display.ts` — **presentational** labels/formatting only
   (`meetingModeLabel`, `formatWallTime`, `COMMON_TIMEZONES`); **no engine logic.**
6. *Scoped-carefully / shared surfaces* — change **additively** or add a schedule-scoped variant to
   avoid regressing other public pages and app chrome:
   - `src/components/public/PublicShell.tsx` (also used by referral/upload/legal public forms)
   - `src/components/PublicFooter.tsx` (shared public footer)
   - `src/components/portal/BrandMark.tsx` (shared app lockup mark — prefer adding a public logo
     variant using the approved `public/brand/farmers-logo.svg` rather than mutating the monogram)
   - `src/app/globals.css` / `tailwind.config.ts` (global tokens — **append-only** preferred)
7. **New** `src/app/schedule/loading.tsx` / `error.tsx` (currently absent) for route-level states.

### 7.2 Files P1 MUST NOT modify (engine / wire contracts) without a verified, human-approved defect
1. `src/app/api/public/booking/route.ts` — POST booking contract.
2. `src/app/api/public/booking/availability/route.ts` — availability contract + `Slot`/`type` shape.
3. `src/app/api/public/booking/manage/route.ts` — manage GET/POST contract.
4. `src/lib/booking/config-schemas.ts` — `PublicBookingInput` Zod (field names are the wire contract).
5. `src/lib/booking/book.ts`, `manage.ts`, `slots.ts`, `availability.ts`, `timezone.ts`,
   `manage-tokens.ts`, `ics.ts` — booking / slot / token / ICS engine.
6. `src/lib/comms/personalize.ts`, `src/lib/booking/notify.ts`, `notify-core.ts` — shared render /
   send path (owned by campaign work; Section-3 rule).
7. `src/lib/data/query.ts`, `src/lib/http/*`, `src/lib/site.ts` — server data / HTTP / config plumbing.

### 7.3 Public API contracts P1 consumes (unchanged)
- `GET /api/public/booking/availability?type&tz&from&days` → `{ type{name,slug,description,
  durationMinutes,meetingMode}, timezone, slots }`.
- `POST /api/public/booking` (Zod `PublicBookingInput`: `typeSlug, startsAt, bookerTimezone, name,
  email, phone?, notes?, company?`-honeypot) → `201 { ok, confirmation }`; `409` taken/unavailable;
  `429` rate-limit; `400/404/500`.
- `GET /api/public/booking/manage?t=<signedToken>` → `{ purpose, appointment{...} }`;
  `POST` discriminated on `action: 'cancel' | 'reschedule'`.

---

## 8. P0 verdict

- **Section 3 = State (a).** Shared render fix present on base; booking-email defect **RESOLVED**;
  do not re-implement; P5 send dependency satisfied.
- **Booking backend verified production-grade** across availability/DST, DB double-booking guard,
  atomic create/reschedule, signed tokens, Google (read-only, degrade-safe), Zoom (gated no-op),
  ICS, cron reminders, config CRUD, and contact-scoped CRM linkage. **Preserve — do not rebuild.**
- **Baseline is clean** (type-check / lint / unit / rls / build all green); no pre-existing failures.
- **No automated e2e / a11y / visual harness** exists — disclosed; manual verification only until a
  bounded P4 harness decision.
- **Three documented backend items (D1–D3)** require human approval before any behavior change and
  are **out of P1 scope.**
- **P1 file boundary is fixed** (§7). P1 public-UI work may proceed; it does not touch the engine or
  the shared render/send path.

**Verdict: P0 complete — Ready for P1.** Push / PR / merge / deploy await explicit human
authorization per the operating mode.
