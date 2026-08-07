-- ─────────────────────────────────────────────────────────
-- Migration: 105_comm_template_version_history
--
-- Adds the version history comm_templates has never had (ADR-037).
--
-- THE GAP: comm_templates carries a `version` integer that every write path bumps,
-- but the prior body is overwritten in place and lost. api/comms/templates/[id]
-- said so outright — "old body retained in a prior version row is out of scope for
-- P1". In a regulated context the agency must be able to evidence which copy was
-- approved and in force at a given time; a bare version counter cannot do that.
--
-- WHY A TRIGGER, NOT A SERVICE HOOK: six distinct paths update comm_templates —
-- the PATCH edit, the submit transition, the approve/reject transition, the bulk
-- route, the two build-*-templates scripts, and the copy migrations themselves
-- (099/100/101). A service-layer hook would have to be added in six places and
-- would still miss raw SQL and future migrations. Retention evidence that can be
-- bypassed is not evidence, so the snapshot is enforced in the database where no
-- caller can route around it. (CLAUDE.md §13.6 — layered enforcement at the store.)
--
-- WHAT IS CAPTURED: the OLD row, at the moment it is superseded. Because the PATCH
-- route bumps version and resets approval in the SAME update, the snapshot of OLD
-- records exactly the wanted fact — "v1 copy, in approval state X, was in force
-- until it was superseded". body_text and render_sha are captured alongside body
-- because ADR-025 makes all three parts of the one approved, immutable artifact;
-- snapshotting the HTML without the plaintext part would preserve half the evidence.
--
-- WHAT IS NOT CAPTURED: approval transitions that do not change copy. Those are
-- already written to audit_log by writeAudit('approval.decided'), and duplicating
-- them here would fork a second audit subsystem (§6). This table answers "what did
-- the copy say"; audit_log answers "who changed its state, and when".
--
-- APPEND-ONLY, mirroring audit_log as it stands AFTER migration 077 — not as migration
-- 010 first built it: UPDATE and DELETE are revoked from the app roles AND blocked by a
-- row trigger, and TRUNCATE (which those revokes miss and row triggers never see) is
-- revoked and blocked by its own statement trigger. 077 exists because audit_log shipped
-- without that third guard; there is no reason to reintroduce the same hole here. The
-- history is therefore tamper-evident even against the table owner. The FK is `on delete restrict`
-- rather than `on delete cascade` for the same reason — deleting a template must
-- not be a way to erase the record of what it used to say. Nothing in the app hard-
-- deletes a template (the UI archives via archived_at), so this restricts nothing
-- that currently happens.
--
-- NO UNIQUE (template_id, version). A caller that changes a body twice without
-- bumping the version is a caller bug, but rejecting its write would turn this
-- evidence trigger into a denial of service on template editing, and `on conflict
-- do nothing` would silently drop evidence. An append-only log takes both rows and
-- lets superseded_at tell them apart — the honest failure mode of the three.
--
-- Additive, forward-only, idempotent (create-if-not-exists + create-or-replace;
-- the trigger's own WHEN clause makes a re-run of a copy migration a no-op, since
-- an unchanged body fires nothing). Transaction-safe; no explicit BEGIN/COMMIT.
-- No securities data (firewall §4.1). No client-facing surface.
-- ─────────────────────────────────────────────────────────

create table if not exists comm_template_versions (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references comm_templates(id) on delete restrict,
  version         integer not null,
  name            text not null,
  channel         text not null,
  category        text,
  body            text not null,
  body_text       text,
  render_sha      text,
  approval_status text not null,
  approved_at     timestamptz,
  approved_by     text,
  superseded_at   timestamptz not null default now(),
  superseded_by   text
);

comment on table comm_template_versions is
  'Append-only snapshot of a comm_templates row taken at the moment its copy is superseded (ADR-037). Retention evidence: what the copy said, at what version, and in what approval state it stood when replaced. Written only by trg_comm_templates_snapshot; never by application code.';
comment on column comm_template_versions.approval_status is
  'The approval state of the SUPERSEDED row, not the replacement. approved here means this exact body was approved and in force until superseded_at.';
comment on column comm_template_versions.superseded_by is
  'The superseding writer, recorded only when the UPDATE actually asserted one (updated_by changed). NULL for writes that set no actor — bulk SQL, scripts, migrations — and for an actor editing twice consecutively, rather than carrying a stale name forward. A wrong actor in an evidence column is worse than an absent one; audit_log remains the authoritative per-edit actor record.';

create index if not exists idx_ctv_template on comm_template_versions (template_id, version desc);

-- ── The snapshot trigger ────────────────────────────────────────────────────
-- SECURITY DEFINER is required, not incidental: the app roles are granted no
-- INSERT on this table (below), so an invoker-rights trigger would fail to write
-- the very snapshot it exists to take. search_path is pinned so the definer-rights
-- body cannot be redirected to an attacker-controlled schema.
create or replace function comm_template_snapshot_version()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into comm_template_versions (
    template_id, version, name, channel, category,
    body, body_text, render_sha,
    approval_status, approved_at, approved_by, superseded_by
  ) values (
    old.id, old.version, old.name, old.channel, old.category,
    old.body, old.body_text, old.render_sha,
    old.approval_status, old.approved_at, old.approved_by,
    -- Attribute ONLY when this UPDATE actually asserted an actor. updated_by is a
    -- persisted column, so new.updated_by alone still carries the LAST setter's name
    -- forward into writes that never touched it (a bulk SQL or script edit would be
    -- credited to whoever last used the PATCH route). current_user is no better: inside
    -- a SECURITY DEFINER body it resolves to the function owner, not the updater.
    -- nullif() therefore records an actor only when the write changed one.
    --
    -- Known false negative: the same actor editing twice in a row leaves the second
    -- snapshot unattributed. That is the deliberate direction to err — in a column that
    -- exists to answer "who", absent is recoverable from audit_log (which records every
    -- edit with its actor and timestamp) while a confidently wrong name is not.
    nullif(new.updated_by, old.updated_by)
  );
  return null; -- AFTER trigger: the return value is ignored.
end;
$$;

drop trigger if exists trg_comm_templates_snapshot on comm_templates;
create trigger trg_comm_templates_snapshot
  after update on comm_templates
  for each row
  when (old.body is distinct from new.body or old.body_text is distinct from new.body_text)
  execute function comm_template_snapshot_version();

-- ── RLS: internal ops data, read-only, append-only ──────────────────────────
-- Read for the roles that run and supervise the campaigns, matching the 083
-- convention. Never client/agency_owner. No write grant to any app role — rows
-- arrive only via the definer-rights trigger above.
alter table comm_template_versions enable row level security;
revoke insert, update, delete on comm_template_versions from anon, authenticated;
grant select on comm_template_versions to authenticated;

drop policy if exists ctv_read on comm_template_versions;
create policy ctv_read on comm_template_versions for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);

-- Tamper-evidence, mirroring trg_audit_log_no_mutate (migration 010).
create or replace function comm_template_versions_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'comm_template_versions is append-only (% not permitted)', tg_op;
end;
$$;

drop trigger if exists trg_ctv_no_mutate on comm_template_versions;
create trigger trg_ctv_no_mutate
  before update or delete on comm_template_versions
  for each row execute function comm_template_versions_block_mutation();

-- TRUNCATE is a separate vector and needs its own guard: it is not covered by
-- `revoke ... delete`, and row-level triggers do not fire for it. This is the same hole
-- audit_log carried until migration 077 closed it; an evidence table that can be emptied
-- in one statement is not tamper-evident. Nothing in the app, jobs, tests, or migrations
-- truncates this table, so blocking it removes only an abuse path.
revoke truncate on comm_template_versions from public;

create or replace function comm_template_versions_block_truncate()
returns trigger language plpgsql as $$
begin
  raise exception 'comm_template_versions is append-only (TRUNCATE not permitted)';
end;
$$;

drop trigger if exists trg_ctv_no_truncate on comm_template_versions;
create trigger trg_ctv_no_truncate
  before truncate on comm_template_versions
  for each statement execute function comm_template_versions_block_truncate();

-- ── PRIOR HISTORY (deliberately not backfilled) ─────────────────────────────
-- Migrations 099/100/101 already replaced the v1 lifecycle copy, so the pre-105
-- bodies are gone from the database. They are NOT lost: migrations 082/084/086
-- are immutable and still in version control, and remain the authoritative record
-- of the v1 copy. They are not inserted here because the one field this table
-- exists to establish — WHEN a body was superseded — is unknowable after the fact,
-- and seeding a compliance evidence table with an invented timestamp would be
-- worse than an honest gap (§4.3). History accumulates from this migration onward.

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   drop trigger if exists trg_comm_templates_snapshot on comm_templates;
--   drop function if exists comm_template_snapshot_version();
--   drop trigger if exists trg_ctv_no_mutate on comm_template_versions;
--   drop function if exists comm_template_versions_block_mutation();
--   drop trigger if exists trg_ctv_no_truncate on comm_template_versions;
--   drop function if exists comm_template_versions_block_truncate();
--   -- The history table itself is retention evidence; drop it only deliberately:
--   -- drop table comm_template_versions;
