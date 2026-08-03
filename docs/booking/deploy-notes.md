# Booking Modernization — Deploy & Rollback Notes

> Running checklist of deployment prerequisites and rollback levers introduced by the booking
> modernization phases. Reviewed before any production deploy of this program. Nothing here is a
> code change; it is operational configuration the human applies at deploy time.

## Required environment configuration

### D2 — manage-token signing key (REQUIRED before ship) 🔒
**Introduced by:** the D2 security fix (`src/lib/booking/manage-tokens.ts`) — `manageTokenKey()`
now **fails closed**: it throws when no signing key is configured instead of using the old
hardcoded fallback (`'fsos-dev-booking-token-key-change-me'`), which was forgeable.

**Action:** set **`BOOKING_TOKEN_KEY`** (preferred) — or the shared **`FSOS_API_SECRET`** /
`SOCIAL_TOKEN_KEY` — to a high-entropy secret in **Vercel Production** (and any Preview
environment that serves real booking links) **before this ships.**

**If unset in production:** signed reschedule/cancel links cannot be signed or verified —
- `/api/public/booking/manage` verification throws → route returns 500 (fail-closed; nothing
  forgeable — this is the intended safe failure, not silent verification against a guessable key);
- confirmation email link-building throws but is caught best-effort in `book.ts` (booking creation
  is **not** affected; it falls through to the transactional fallback);
- the booking-reminders cron surfaces a 500 until the key is set.

**Rollback:** this is config, not code — setting the env var resolves it immediately with no
redeploy of application logic required. Do **not** reintroduce a hardcoded fallback.

## Required migrations (forward-only, apply under the repo's migration workflow)

### D3 — appointment overlap exclusion — `supabase/migrations/091_appointments_overlap_exclusion.sql`
**Introduced by:** the D1/D3 backend hardening slice. Adds a GiST `EXCLUDE` constraint so the
**database** rejects two *scheduled* appointments for the same host with overlapping
`[starts_at, ends_at)` ranges (defense-in-depth over the app-layer buffer math; complements, does
not replace, `uq_appointments_host_slot`).

**Apply steps (human, forward-only — do NOT run against prod from this environment):**
1. Run the **pre-apply overlap check** in the migration header — it must return **0 rows**. If any
   overlaps exist, resolve them first, or `ADD CONSTRAINT` will fail.
2. Apply `091_appointments_overlap_exclusion.sql` via the repo migration workflow. It installs
   `btree_gist` and adds `excl_appointments_host_overlap`. Takes an `ACCESS EXCLUSIVE` lock +
   one validating scan; fast on the current (small) table — otherwise use a maintenance window.
3. **Rollback:** `alter table appointments drop constraint excl_appointments_host_overlap;`
   (leaving `btree_gist` installed is harmless.)

**Apply-time cautions (owner-directed):**
1. **The pre-apply overlap check MUST return 0 rows before the constraint is created.** If it
   returns any rows, **STOP** — do not force or `NOT VALID`-bypass the constraint. Surface the exact
   overlapping row pairs (the check selects `a_id, b_id, host_user_id`) to the owner and resolve
   them first; a forced constraint would either fail or hide real double-bookings.
2. **Confirm every live *scheduled* appointment populates `ends_at` before relying on this guard.**
   The partial predicate (`… and ends_at is not null`) **silently skips** any scheduled row with a
   null `ends_at`, so such rows are NOT protected by the exclusion. Run a coverage check first —
   `select count(*) from appointments where status='scheduled' and ends_at is null;` should be 0;
   if not, backfill `ends_at` (from `starts_at` + the type's `duration_minutes`) before treating the
   overlap guard as complete. (`uq_appointments_host_slot` still guards exact-start collisions on
   those rows in the meantime.)

**Backward compatibility:** additive only; no app change depends on it. The D1 code fix
(status-guarded conditional cancel/transition write) ships independently and needs no migration.

## Pre-ship verification gates (not config — must be closed before go-live)

### P1 — accessibility / responsive / screen-reader verification is INSPECTION-ONLY 🔒
P1 was accepted **Ready for Review**, but its a11y, responsive, and screen-reader conformance were
**verified by inspection only — no automated harness exists in this repo** (no Playwright / axe /
Lighthouse; see `docs/booking/P1-report.md` §5.2). This is a **hard prerequisite before ship**, not
an assumed pass: WCAG 2.2 AA (keyboard path, focus order, SR announcements, measured contrast) and
responsive behavior at real breakpoints must be **actually verified** — to be closed by the **P4
bounded test-harness decision** (Playwright + axe) or an equivalent human browser + assistive-tech
pass. Do **not** treat P1's inspection-level review as harness-backed conformance.

### Comms RLS is APP-LAYER ONLY — DB row-isolation not enforced on comm tables 🔒
`comm_messages` (no row policy) and `comm_message_events` (only the role-coarse `mevt_read`) are
RLS-**enabled but not tenant-scoped and not FORCE'd**. Every application path reads/writes via the
service-role client (`getDb`, `BYPASSRLS`), so the **P2.3 appointment-timeline row isolation is
enforced in application code, not the database** (the loader's `entity_type`/`entity_id` filter +
role-based redaction). **Acceptable in single-FSA production today** (one advisor, one book, no
second reader) — but a **hard blocker before any second-tenant / partner / multi-advisor context**,
which is itself already deferred, so it lines up. Before any such multi-tenant / partner-facing read
path touches these tables, a **comms-wide** tenant-scoping policy + write-path validation + FORCE
(with `rls-firewall` coverage) is required. FORCE-only would be pure owner-bypass hardening (zero
functional blast radius — service-role bypasses regardless) and does **not** by itself create
isolation. **Owner: comms/campaign security model — NOT booking** (do not slice into a booking
migration; collision with active campaign Phase-2 work in the same files, §3). Tracked finding +
full analysis: `docs/security/comms-row-isolation-finding.md`. (Recorded 2026-08-03; surfaced during
P2.3, verified via `fsos-security-audit`; escalated to platform security.)

### Availability-edit orphan check is point-in-time, not serialized — pre-multi-tenant 🔒
The availability-rule editor refuses a NARROWING change (update/delete) that would leave future
scheduled appointments outside the new template, unless the FSA explicitly acknowledges (409
`availability_conflict`) — it never auto-cancels or moves an appointment (a template change governs
future slots, not commitments already made). The check is a **point-in-time read** (candidate rules
+ future appointments) followed by a **single atomic rule write** — NOT one serializable
transaction. A booking or rule edit landing between the check and the write is not folded in.
**Accepted for single-FSA** (one actor, near-zero race; appointments are only surfaced, never
destroyed, so the worst case is a stale count, never data loss). **Pre-multi-tenant hardening:** a
serializable transaction or advisory lock around validate→check→write is required before concurrent
editors. Implementation: `lib/booking/config.ts` (see the conflict-detection comment). (Recorded
2026-08-03, P3.2.)

## Phase rollback levers
- **P1 (public UI):** presentation-only, no migration; revert the P1 commits to restore the prior
  `/schedule` UI. No data or contract impact.
- **P5 (notification automation):** SMS remains behind an explicit feature flag; disabling the flag
  is the immediate rollback (see the P5 plan when authored).
