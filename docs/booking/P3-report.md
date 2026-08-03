# P3 — Scheduling Settings UI — Completion Report

> Companion to the P1/P2 reports. P3 enhanced the existing `/app/booking` settings surface over the
> existing types/rules/blackouts/calendar CRUD — **no new backend, no migration.** §9.6 held
> throughout: notification config is exposed **read-only**; the P5 advisor reminder scheduler was
> **not** built.

## 1. Executive summary

P3 rounded out the FSA scheduling-settings experience: exposed the existing notification config
read-only, added a settings change-history and a recurring-availability template summary (both on a
single shared rule interpreter so they can't drift from the engine), brought status rendering onto
the shared `StatusBadge`, and hardened the highest-blast-radius write — availability-rule editing —
with engine-matched validation and a non-destructive orphan guard. Appointment-type and
calendar-connection editing already existed and were **verified** guarded rather than rebuilt.

## 2. Scope confirmation

- **Enhance, don't rebuild:** the settings page, the types/rules/blackouts managers, the Google
  Calendar connect flow, and their CRUD endpoints already existed (native-booking Slice 2 + calendar
  work). P3 added read-only surfaces + the availability-edit guard; it did **not** fork a second
  settings surface or backend (§6).
- **§9.6 held:** notification config is read-only; no reminder scheduler, no SMS send path.
- **No migration.** Pure UI + read queries + one narrowing-write guard over existing tables.
- **One rule interpretation:** the summary, the orphan check, and the slot engine all read rules
  through the shared `ruleFromRow` mapper + `timezone.ts` primitives — no independent re-reading.

## 3. Files changed

**Read-only exposures (P3.1):**
- `lib/booking/config-history.ts` (pure) + `components/app/booking/NotificationSettings.tsx` +
  `components/comms/CommTimeline` reuse → Notifications section + change history on the settings page.
- `lib/booking/availability-summary.ts` (pure) + `availability.ts` `ruleFromRow` (extracted, shared
  with `slots.ts`) + `components/app/booking/WeeklyAvailabilitySummary.tsx` → recurring-template
  summary. Wall-time formatting consolidated onto the single `display.formatWallTime`.
- `AppointmentTypesManager` active/hidden → shared `StatusBadge`.

**Availability-edit hardening (P3.2):**
- `availability.ts` `isInstantWithinTemplate()` — containment predicate reusing the engine primitives.
- `availability-rules-validate.ts` (pure) — `validateAvailabilityRules()` (overlap advisory matched
  to the engine's union contract) + `appointmentsOutsideTemplate()`.
- `config.ts` — `availability_conflict` guard on `updateAvailabilityRule`/`deleteAvailabilityRule`.
- `api/app/booking/rules/[id]/route.ts` — `409 availability_conflict` + `acknowledge`.
- `AvailabilityRulesManager` — surfaces the conflict, requires explicit acknowledge.

**Tests:** `booking-config-history` (3), `booking-availability-summary` (5),
`booking-availability-rules-validate` (5) — 13 new pure assertions.

**Docs:** this report; `deploy-notes.md` ledger (availability-conflict concurrency item).

**Verified already-present + guarded (not rebuilt):** appointment-type editing (`types`,
`types/[id]` — `requireApiRole`+`requirePermission`+Zod+audit) and calendar-connection editing
(`calendar/oauth/start`, `oauth/callback`, `calendar` DELETE — same guards + `config.changed` audit).

## 4. Database changes

**None.** No migration. Reads/one-guarded-write over existing tables (`availability_rules`,
`appointments`, `audit_log`, `appointment_types`, `booking_calendar_connections`).

## 5. Verification

### 5.1 Automated (green at completion)
- `type-check` ✓ · `lint` ✓ · `build` ✓ · `npm test` ✓ — **134 unit test files** (incl. the 13 new
  P3 assertions and `booking-availability`/`booking-config` confirming the engine `ruleFromRow`
  extraction is behavior-preserving).

### 5.2 Verified by inspection (no a11y/e2e harness — standing P4 gate)
- Read-only sections have empty/loaded states; the conflict flow requires an explicit confirm; status
  rendering is tokened via `StatusBadge`; wide content scrolls within its container.

### 5.3 Not performed
- No browser/e2e/axe run (P4 harness gate). No live-Supabase integration test of the conflict
  endpoint (follows the established guarded-service pattern; RLS remains the row guarantee).

## 6. Security & compliance

- Every write stays behind `requireApiRole('fsa')` + `requirePermission` + audit (unchanged).
- The availability-edit orphan guard is **non-destructive**: it surfaces future appointments outside
  the new hours and requires explicit acknowledge; it never cancels or moves a booked appointment.
- Overlap validation is **matched to the engine's verified union contract** (advisory, not a phantom
  rejection) — the editor never diverges from what the engine actually books.
- Notification exposure is read-only (§9.6); the securities firewall is untouched (booking rows are
  `is_security=false`).

## 7. Known limitations / ledger (pre-multi-tenant)

1. **Availability-conflict check is point-in-time, not serialized.** Accepted single-FSA (near-zero
   race; appointments only surfaced, never destroyed). Serializable txn / advisory lock required
   before concurrent editors. (Ledger: `deploy-notes.md`.)
2. **Comms row-isolation is app-layer only** (separate finding, `docs/security/comms-row-isolation-finding.md`)
   — both items gate on the same **pre-multi-tenant / partner** boundary, which is already deferred.
3. a11y/responsive remain inspection-only pending the P4 harness gate.

## 8. Verdict

P3 is complete and green on every automated gate, over the existing settings surface with no
migration and no duplicated subsystem. The one high-blast-radius write (availability editing) was
built against the engine's verified contract with a non-destructive orphan guard, reviewed as a diff
before commit (§0.7). Remaining items are documented pre-multi-tenant ledger entries. **No
push/PR/deploy performed — withheld pending authorization.**
