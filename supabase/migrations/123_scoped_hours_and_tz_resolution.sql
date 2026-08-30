-- ─────────────────────────────────────────────────────────
-- 123 — Scoped send windows + recipient-timezone resolution on the send record
--       (Phase 2 / Batch 1c: dispatch-time chokepoint, configurable quiet hours)
--
-- PART A — comm_hours_policy becomes MULTI-ROW.
--
-- WHY. Quiet hours moves from one project-wide window to a per-campaign / per-worker
-- configurable narrowing. Rather than a new table, the existing hours-policy surface gains
-- scoped rows — the exact reuse pattern migration 104 established when
-- comm_conversation_policy went multi-row for the per-agent turn limit (§6: one
-- hours-policy surface, not two). The primary key was already `text`, so no type change.
--
-- Row addressing:
--   'global'            — the operator's business-hours row (unchanged, still the singleton
--                         the /super/ai/hours screen edits and gate step 2b reads).
--   'agent:<key>'       — a WORKER window, keyed by ai_agents.key (e.g. 'agent:cross_sell').
--   'campaign:<key>'    — a CAMPAIGN window, keyed by the campaign's engine key or id
--                         (e.g. 'campaign:life_conversion').
--
-- Scoped rows can only NARROW: the dispatch chokepoint (lib/comms/quiet-hours-window.ts)
-- INTERSECTS them with the statutory recipient-local floor, so a window wider than the
-- floor is arithmetically incapable of widening it. A DISABLED row is treated as absent
-- (loadScopedHoursWindow), matching migration 104's semantics. Deleting a row removes the
-- narrowing; the floor always remains.
--
-- The 035 CHECK constraints (hour bounds, end > start) already apply to every new row.
--
-- PART B — the send record carries HOW the recipient's timezone was resolved.
--
-- WHY. The quiet-hours floor is now evaluated in the RECIPIENT's zone (behind
-- QUIET_HOURS_RECIPIENT_LOCAL). An enforcement decision made in a resolved zone is only
-- auditable if the record says WHICH zone and ON WHAT EVIDENCE — NPA or ZIP, and which
-- value. Three nullable columns on comm_messages, written by the send path at dispatch:
-- null on historical rows and on rows written while the flag is off and no caller resolved
-- a zone (the legacy America/Chicago evaluation records itself explicitly, so a row's null
-- means "pre-change", never "unknown by silence").
--
-- Additive, forward-only, idempotent; no destructive statement. Runs inside the runner's
-- per-file transaction (no explicit BEGIN).
-- ─────────────────────────────────────────────────────────

-- ── Part A: scoped rows on comm_hours_policy ────────────────────────────────

-- Scoped rows may be disabled without being deleted (config toggling, mig-104 semantics).
-- The 035 table has `enabled` already — nothing to add there.

-- Rows must address a known scope shape. Global stays exactly 'global'; scoped rows carry
-- their kind prefix. Enforced with a CHECK so a typo'd id ('agents:x', 'Campaign:y') cannot
-- silently configure nothing.
alter table comm_hours_policy drop constraint if exists comm_hours_policy_scope_shape;
alter table comm_hours_policy add constraint comm_hours_policy_scope_shape
  check (id = 'global' or id like 'agent:%' or id like 'campaign:%');

comment on table comm_hours_policy is
  'Hours-of-operation policy, MULTI-ROW (mig 123, pattern of mig 104): ''global'' is the operator''s business-hours row (gate step business_hours); ''agent:<ai_agents.key>'' and ''campaign:<key>'' rows are per-worker / per-campaign SEND WINDOWS. Scoped rows are read at the dispatch chokepoint and INTERSECTED with the statutory recipient-local quiet-hours floor — they can only narrow it, never widen it. A disabled row is treated as absent. Missing a configured window DEFERS the send to the window''s next opening (non-escalating); it never suppresses.';

-- The 035 seed named only the global row; scoped rows are operator-created (no seeds — a
-- default narrowing nobody asked for would silently hold real sends).

-- ── Part B: timezone-resolution provenance on the send record ───────────────

alter table comm_messages add column if not exists resolved_timezone    text;
alter table comm_messages add column if not exists tz_resolution_method text
  check (tz_resolution_method in ('npa', 'zip') or tz_resolution_method is null);
alter table comm_messages add column if not exists tz_resolution_input  text;

comment on column comm_messages.resolved_timezone is
  'IANA zone the quiet-hours decision for this send was evaluated in (mig 123). ''America/Chicago'' with method null = the legacy agency-local evaluation (flag off). Null = row predates resolution recording.';
comment on column comm_messages.tz_resolution_method is
  'Evidence class the zone was resolved from: ''npa'' (recipient phone area code, primary) or ''zip'' (recipient ZIP, secondary). Null when the caller supplied the zone (workshop engine), the legacy default applied, or the row predates mig 123.';
comment on column comm_messages.tz_resolution_input is
  'The exact resolution input used — the 3-digit NPA or the ZIP3 — recorded so the decision is reconstructible. Never a full phone/address (data minimization).';

-- No index: these columns are audit/reporting attributes read by row, never a filter on a
-- hot path. (query-missing-indexes: index what you filter on; nothing filters on these.)
