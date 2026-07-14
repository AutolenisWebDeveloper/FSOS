-- ═══════════════════════════════════════════════════════════════════
-- FSOS — P0 support: soft-delete/archive columns, P0 list views, DOB RPCs
-- Migration: 011_p0_softdelete_views_dob
--
-- Adds what the P0 (system-functional) screens need on top of the aggregate-root
-- spine (009) and RLS/guardrails (010):
--   • soft-delete (deleted_at) + archive (archived_at) on the spine entities so the
--     Definition-of-Done "archived / deleted behavior" is real, not cosmetic;
--   • the P0 list views the specs reference (v_agencies_overdue_checkin,
--     v_referrals_awaiting_action) so aging/dormancy badges are DB-derived;
--   • pgcrypto DOB helpers exposed as SECURITY-DEFINER RPCs so the app writes /
--     reads member DOB without ever handling the ciphertext itself. The app passes
--     the key (env DOB_ENCRYPTION_KEY); role-gating of decrypt is enforced at the
--     app layer (rbac) and every DOB view is audited.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- 1. Soft-delete + archive columns on the spine entities
-- ─────────────────────────────────────────────────────────
alter table agency_partnerships add column if not exists archived_at timestamptz;
alter table agency_partnerships add column if not exists deleted_at   timestamptz;

alter table households         add column if not exists archived_at timestamptz;
alter table households         add column if not exists deleted_at   timestamptz;

alter table household_members  add column if not exists deleted_at   timestamptz;

alter table referrals          add column if not exists archived_at timestamptz;
alter table referrals          add column if not exists deleted_at   timestamptz;

alter table household_policies  add column if not exists archived_at timestamptz;
alter table household_policies  add column if not exists deleted_at   timestamptz;

alter table opportunities      add column if not exists archived_at timestamptz;
alter table opportunities      add column if not exists deleted_at   timestamptz;

alter table work_tasks         add column if not exists deleted_at   timestamptz;

create index if not exists idx_agency_partnerships_live on agency_partnerships(deleted_at) where deleted_at is null;
create index if not exists idx_households_live          on households(deleted_at) where deleted_at is null;
create index if not exists idx_referrals_live           on referrals(deleted_at) where deleted_at is null;
create index if not exists idx_policies_live            on household_policies(deleted_at) where deleted_at is null;
create index if not exists idx_opportunities_live       on opportunities(deleted_at) where deleted_at is null;

-- ─────────────────────────────────────────────────────────
-- 2. P0 list views (aging / dormancy). Derived so UI badges cannot drift.
-- ─────────────────────────────────────────────────────────

-- Agencies overdue for a relationship check-in (per-partnership interval).
-- Dormancy badge on /app/agencies must match this view (spec OS-02 acceptance).
create or replace view v_agencies_overdue_checkin as
select
  ap.id,
  ap.agency_name,
  ap.owner_name,
  ap.status,
  ap.last_contact_at,
  ap.checkin_interval_days,
  (
    ap.last_contact_at is null
    or ap.last_contact_at < now() - make_interval(days => ap.checkin_interval_days)
  ) as overdue_checkin
from agency_partnerships ap
where ap.deleted_at is null;

-- Referrals awaiting action, with SLA/aging state. Colors on /app/referrals must
-- match this (spec OS-03 acceptance): untouched past SLA = breached.
create or replace view v_referrals_awaiting_action as
select
  r.id,
  r.referring_agency_id,
  r.referred_name,
  r.engagement,
  r.status,
  r.received_at,
  r.first_touch_at,
  r.sla_due_at,
  (r.first_touch_at is null) as untouched,
  (r.first_touch_at is null and r.sla_due_at is not null and r.sla_due_at < now()) as sla_breached,
  extract(epoch from (now() - r.received_at)) / 3600.0 as age_hours
from referrals r
where r.deleted_at is null
  and r.status in ('received', 'working');

-- ─────────────────────────────────────────────────────────
-- 3. DOB RPCs (pgcrypto). The app never touches ciphertext; it passes the key.
--    Decrypt is additionally role-gated at the app layer and every read audited.
-- ─────────────────────────────────────────────────────────

-- Create a member with an encrypted DOB in one call. Returns the new row id.
create or replace function member_create(
  p_household_id uuid,
  p_full_name    text,
  p_relationship text,
  p_dob          date,
  p_email        text,
  p_phone        text,
  p_key          text
) returns uuid language plpgsql security definer as $$
declare
  v_id uuid;
begin
  insert into household_members (household_id, full_name, relationship, dob_enc, email, phone)
  values (
    p_household_id,
    p_full_name,
    nullif(p_relationship, ''),
    case when p_dob is null then null else encrypt_dob(p_dob, p_key) end,
    nullif(p_email, ''),
    nullif(p_phone, '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Update a member (including re-encrypting DOB when provided).
create or replace function member_update(
  p_id           uuid,
  p_full_name    text,
  p_relationship text,
  p_dob          date,
  p_email        text,
  p_phone        text,
  p_key          text
) returns void language plpgsql security definer as $$
begin
  update household_members set
    full_name    = coalesce(p_full_name, full_name),
    relationship = nullif(p_relationship, ''),
    email        = nullif(p_email, ''),
    phone        = nullif(p_phone, ''),
    dob_enc      = case when p_dob is null then dob_enc else encrypt_dob(p_dob, p_key) end,
    updated_at   = now()
  where id = p_id;
end;
$$;

-- Read a member's decrypted DOB. App gates by role BEFORE calling and audits after.
create or replace function member_dob(p_id uuid, p_key text)
returns date language sql stable security definer as $$
  select case when dob_enc is null then null else decrypt_dob(dob_enc, p_key) end
  from household_members where id = p_id;
$$;
