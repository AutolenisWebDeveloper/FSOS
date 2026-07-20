-- 039_workshop_attendance_ops.sql
-- P1 of the Workshop/Seminar lead engine (docs/specs/workshops-seminar-design-spec.md §5,§9-P1):
-- attendance capture (kiosk check-in + manual reconcile), roster+convert, dashboard, and
-- per-workshop reporting. ADDITIVE ONLY. No drops, no destructive alters.
--
-- The P0 shell already carries the attendance store (workshop_attendance: registered/
-- attended/no_show/left_early, capture_method checkin|webhook|manual, unique
-- (registration_id, session_id)) and the per-registrant join_token (unique). This
-- migration adds ONLY the few columns P1 reporting/convert need that 038 did not ship:
--   - workshops.budget_spend / budget_spend_note  -> cost-per-lead (assumption-badged; a
--     planning figure the FSA enters, never a Farmers-published number — guardrail 3).
--   - workshop_registrations.is_walk_in           -> distinguishes kiosk walk-ins from
--     pre-registrations for attribution/reporting.
--   - workshop_registrations.ghl_opportunity_id / lead_converted_at -> track the GHL
--     Pipeline-A opportunity created by the manual "convert to lead" action (P1); P2
--     automates it. (ghl_contact_id already exists from 038.)
--
-- GUARDRAILS honored here:
--  - Guardrail 1 (securities firewall): NO securities account/order/suitability columns.
--    is_security stays a FLAG only; the convert route routes an is_security workshop's
--    attendee to the FFS-supervised path (never the automated comms engine).
--  - Guardrail 3 (no invented Farmers data): budget_spend is an FSA-entered planning
--    figure; cost-per-lead renders with the gold assumption badge in the UI.
--  - Guardrail 4 (audit): every mutation is audited in the API routes (not here).
--
-- RLS: no NEW tables are introduced. workshop_attendance already has default-deny RLS
-- with staff/compliance read (038) and service-role-only writes (getDb bypasses RLS after
-- an rbac assertion in the route). New columns inherit their table's existing policies;
-- no anon grant is added anywhere.
--
-- NOTE: comments are on their own lines and contain no semicolons, so every terminator in
-- this file is a real one (safe for naive SQL splitters), matching the 038 convention.

-- ===========================================================================
-- 1. workshops: optional spend for cost-per-lead (assumption-badged in the UI).
-- ===========================================================================
alter table workshops add column if not exists budget_spend numeric(12,2);
alter table workshops add column if not exists budget_spend_note text;

-- ===========================================================================
-- 2. workshop_registrations: walk-in flag + GHL lead-conversion tracking.
-- ===========================================================================
alter table workshop_registrations add column if not exists is_walk_in boolean not null default false;
alter table workshop_registrations add column if not exists ghl_opportunity_id text;
alter table workshop_registrations add column if not exists lead_converted_at timestamptz;

-- ===========================================================================
-- 3. Indexes supporting the P1 aggregation reads (dashboard + per-workshop report).
--    workshop_attendance already has unique (registration_id, session_id); add a
--    session index for the roster/report join, and a workshop index on registrations
--    is already present (001). All additive / if-not-exists.
-- ===========================================================================
create index if not exists idx_wattendance_session on workshop_attendance(session_id);
create index if not exists idx_wattendance_status on workshop_attendance(status);
create index if not exists idx_wreg_walk_in on workshop_registrations(is_walk_in) where is_walk_in = true;

-- ===========================================================================
-- 4. RLS reaffirmation (defense in depth — these ran in 018/038; re-running is a
--    no-op if already enabled). NO new policies, NO anon grant. Writes stay on the
--    service role after the route-level rbac assertion.
-- ===========================================================================
alter table workshop_attendance      enable row level security;
alter table workshop_registrations   enable row level security;
