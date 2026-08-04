-- ─────────────────────────────────────────────────────────
-- Migration: 097_contact_notes
--
-- Contact 360 Notes (redesign follow-up). A note is a first-class, EDITABLE,
-- pinnable, soft-deletable free-text record the FSA writes against a household
-- (and optionally a specific member). It is deliberately NOT stored in the
-- append-only `activities` stream — activities is the immutable system-event /
-- audit spine and cannot carry pin/edit/delete without breaking those semantics.
-- Notes surface INTO the ContactTimeline as `note` entries (merged at read time)
-- and also power a notes-only filter.
--
-- A note is NOT a communication: it has no automated-send path, never routes
-- through the dispatcher, and is internal to the FSA. The securities firewall and
-- DOB handling are unchanged by this table.
--
-- RLS posture: matches the established app-layer cohort (comm_messages /
-- booking_notification_deliveries) — RLS ENABLED with a role-gated STAFF READ
-- policy; writes run service-role AFTER the requireApiRole assertion in the API,
-- with an audit_log row written per mutation by the route (writeAudit). Not FORCE'd
-- and not tenant-scoped (single-FSA book; recorded in the pre-multi-tenant ledger).
-- This is the SAME pattern, deliberately not a third one.
--
-- Forward-only, idempotent; the runner applies the file atomically (no BEGIN/COMMIT).
-- ─────────────────────────────────────────────────────────

create table if not exists notes (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  -- nullable: a household-level note has no member; a member note pins to a person.
  member_id     uuid references household_members(id) on delete cascade,
  author_id     text not null,                 -- authenticated user id (actorOf(session))
  body          text not null,
  is_pinned     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz                    -- soft delete; live rows have deleted_at is null
);

-- Read paths: notes for a household (timeline + notes filter) and for a member
-- (member-scoped variant). Partial on live rows so soft-deleted notes never scan.
create index if not exists idx_notes_household on notes (household_id, created_at desc) where deleted_at is null;
create index if not exists idx_notes_member    on notes (member_id, created_at desc)    where deleted_at is null;

-- RLS — enabled, role-gated staff read; service-role writes after the API rbac gate.
alter table notes enable row level security;

drop policy if exists notes_read on notes;
create policy notes_read on notes for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
  or has_role('compliance') or has_role('supervisor')
);
