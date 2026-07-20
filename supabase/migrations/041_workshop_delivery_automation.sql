-- 041_workshop_delivery_automation.sql
-- P3 of the Workshop/Seminar lead engine (docs/specs/workshops-seminar-design-spec.md
-- §2.6, §5, §9-P3): virtual delivery automation — per-registrant Zoom provisioning, the
-- Zoom attendance webhook, finite-window replay, and the post-event feedback survey.
-- ADDITIVE ONLY. No drops, no destructive alters. Extends the P0/P1/P2 spine
-- (018 + 038 + 039 + 040).
--
-- What this migration adds (and, notably, what it does NOT need to add):
--   - workshop_feedback: post-event survey (rating 1-5, most_useful, consult_requested).
--     ABSENT from 038 (the §6 sketch listed it but P0 shipped without it) — added here.
--   - workshop_registrations.zoom_registrant_id: the Zoom-issued registrant id, stored at
--     provisioning so the attendance webhook can correlate participant events by TOKEN,
--     never by name (§5). (join_token + join_url already exist from 038.)
--   - workshop_comms_config.left_early_threshold_minutes: the config default the webhook
--     derives left_early against (assumption-badged; the singleton is already
--     is_assumption = true). replay_window_days already exists from 040 — reused as-is.
--   - workshop_attendance.capture_method ALREADY allows 'webhook' (038) — NO alter needed.
--
-- GUARDRAILS honored here:
--  - Guardrail 1 (securities firewall): NO securities account/order/suitability columns.
--    Nothing here sends data to Zoom; provisioning (in the route) transmits only name +
--    email. is_security workshops stay excluded from the automated comms/consult engine;
--    a feedback consult_requested on an is_security workshop routes to the FFS-supervised
--    path in the route, never the automated sequence.
--  - Guardrail 3 (no invented Farmers data): left_early_threshold_minutes + replay window
--    are CONFIG DEFAULTS (is_assumption = true), editable, assumption-badged in the UI —
--    never asserted as a Farmers/Zoom-published fact.
--  - Recording = retained communication (17a-4/4511): the recording/replay surface cannot
--    activate publicly until an APPROVED (is_assumption = false, approved_by set)
--    recording-consent disclosure config exists AND the workshop references it. That gate
--    is enforced in the replay loader/route (like the 038 publish gate); no column here
--    weakens it. recording_url / recording_expires_at already exist from 038.
--  - Guardrail 4 (audit): every mutation is audited in the API routes (not here).
--
-- RLS: default-deny on the new table; internal-staff/compliance read per role; writes run
-- through the service role after an rbac assertion in the route (getDb bypasses RLS). NO
-- anon grant anywhere. The Zoom webhook + public feedback routes write via the service role
-- after signature/honeypot+rate-limit verification, never an anon RLS grant.
--
-- NOTE: comments are on their own lines and contain no semicolons, so every terminator in
-- this file is a real one (safe for naive SQL splitters), matching the 038/039/040 convention.

-- ===========================================================================
-- 1. workshop_registrations: Zoom registrant id for webhook correlation.
--    Provisioning stores the Zoom-issued registrant id here; the attendance webhook
--    correlates participant_joined/_left events to a registration by THIS value (never by
--    name — §5). join_token (QR/check-in) and join_url (per-registrant link) already exist.
-- ===========================================================================
alter table workshop_registrations add column if not exists zoom_registrant_id text;
create index if not exists idx_wreg_zoom_registrant on workshop_registrations(zoom_registrant_id)
  where zoom_registrant_id is not null;

-- ===========================================================================
-- 2. workshop_comms_config: the left_early duration threshold the Zoom webhook derives
--    left_early against. Assumption-badged (the singleton row is already is_assumption =
--    true). A participant whose total joined span is below this many minutes is marked
--    left_early rather than attended. Editable — a planning choice, not a Farmers fact.
-- ===========================================================================
alter table workshop_comms_config add column if not exists left_early_threshold_minutes integer not null default 10;

-- ===========================================================================
-- 3. workshop_feedback: post-event survey + consult intent. One row per registration
--    (unique) so a re-submit updates in place (idempotent). consult_requested = true is
--    routed into the EXISTING consult spine by the feedback route (GHL Pipeline-A for
--    non-securities; the FFS-supervised path for is_security workshops — never the
--    automated sequence). No securities data.
-- ===========================================================================
create table if not exists workshop_feedback (
  id                uuid primary key default gen_random_uuid(),
  registration_id   uuid not null references workshop_registrations(reg_id) on delete cascade,
  session_id        uuid references workshop_sessions(id) on delete set null,
  rating            integer check (rating is null or (rating between 1 and 5)),
  most_useful       text,
  consult_requested boolean not null default false,
  submitted_at      timestamptz not null default now(),
  unique (registration_id)
);
create index if not exists idx_wfeedback_reg on workshop_feedback(registration_id);
create index if not exists idx_wfeedback_consult on workshop_feedback(consult_requested)
  where consult_requested = true;

-- ===========================================================================
-- 4. RLS — default-deny; staff/compliance read per role; writes via service role.
--    Mirrors the 038/040 policy shape exactly. NO anon grant. NO insert/update/delete
--    policy (all writes go through getDb / the service role after verification in the
--    route; getDb bypasses RLS).
-- ===========================================================================
alter table workshop_feedback enable row level security;

drop policy if exists wfeedback_staff_read on workshop_feedback;
create policy wfeedback_staff_read on workshop_feedback for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

-- Reaffirm RLS on the tables the webhook writes (defense in depth — these ran in 038/039).
alter table workshop_attendance    enable row level security;
alter table workshop_registrations enable row level security;
