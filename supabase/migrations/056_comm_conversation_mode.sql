-- ─────────────────────────────────────────────────────────
-- Migration: 056_comm_conversation_mode
--
-- Native Communications Platform — SLICE 4: campaign mode vs conversation mode
-- (master build instruction §10; ADR-018). A customer reply pauses promotional
-- automation so FSOS never sends a "we haven't heard back" follow-up after the customer
-- has already replied.
--
--   1. comm_campaign_enrollments.status gains 'paused_for_conversation' + pause/resume
--      tracking columns. The drip runner only advances status='enrolled', so a paused
--      enrollment is automatically skipped until it is resumed.
--   2. comm_conversation_policy — the editable quiet period after which a quiet contact's
--      automation resumes (config default / is_assumption, §4.3).
--
-- Additive, forward-only, idempotent. Existing rows keep their status; new columns are
-- nullable. No securities data (firewall §4.1). No GHL surface touched (§0.A).
-- ─────────────────────────────────────────────────────────

-- ── 1. Pause status + tracking on the enrollment ─────────────────────────────
alter table comm_campaign_enrollments drop constraint if exists comm_campaign_enrollments_status_check;
alter table comm_campaign_enrollments
  add constraint comm_campaign_enrollments_status_check
  check (status in ('enrolled','sent','suppressed','opted_out','completed','paused_for_conversation'));

alter table comm_campaign_enrollments
  add column if not exists paused_at    timestamptz,
  add column if not exists pause_reason text,
  add column if not exists resumed_at   timestamptz;

comment on column comm_campaign_enrollments.pause_reason is
  'Why the enrollment is PAUSED_FOR_CONVERSATION (§10) — e.g. an inbound customer reply. The drip runner (status=enrolled only) skips it until resume conditions are met.';

-- The resume job scans paused enrollments; index the pause status for it.
create index if not exists idx_enroll_paused
  on comm_campaign_enrollments (status) where status = 'paused_for_conversation';

-- ── 2. Editable conversation policy (resume quiet period) ────────────────────
create table if not exists comm_conversation_policy (
  id                 text primary key default 'global',
  -- Days a contact must stay quiet (no inbound) before paused automation resumes (§10).
  resume_quiet_days  integer not null default 5 check (resume_quiet_days >= 0),
  is_assumption      boolean not null default true,
  note               text,
  updated_at         timestamptz not null default now()
);

comment on table comm_conversation_policy is
  'Editable conversation-mode policy (§10): the quiet period after which a paused enrollment resumes. Config default (is_assumption) — the FSA sets the real window.';

insert into comm_conversation_policy (id, note)
values ('global', 'Config default — verify the quiet period before automation resumes after a customer reply.')
on conflict (id) do nothing;

-- ── 3. RLS — FSA/staff/compliance/supervisor/admin/super read; service-role writes.
alter table comm_conversation_policy enable row level security;
drop policy if exists ccpol_read on comm_conversation_policy;
create policy ccpol_read on comm_conversation_policy for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
