-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Contact Center: native App B contact store
-- Migration: 026_contacts
--
-- A first-class, securely-stored contact entity for the Contact Center: manual
-- entry + multi-format bulk import land here (in App B), independent of the
-- outbound GoHighLevel sync. Categorized (contact_type, from the AI router),
-- taggable, linkable to a household or agency partnership, with duplicate
-- detection surfaced by v_contact_duplicates.
--
-- Security: RLS default-deny (FSA/staff/admin/compliance/super read); all writes
-- go through the service role AFTER an rbac assertion, and every mutation writes
-- audit_log. email_lc / phone_digits are maintained by the app for fast dedupe
-- (non-unique on purpose — duplicates are DETECTED and surfaced, not hard-blocked).
-- Idempotent; nothing dropped or renamed.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists contacts (
  id                    uuid primary key default gen_random_uuid(),
  first_name            text,
  last_name             text,
  full_name             text not null,
  email                 text,
  email_lc              text,                       -- lower(email), dedupe key (app-maintained)
  phone                 text,
  phone_digits          text,                       -- digits only, dedupe key (app-maintained)
  company               text,
  title                 text,
  contact_type          text not null default 'unknown'
                          check (contact_type in ('agency_owner','client','prospect','term_conversion','cross_sell','business','unknown')),
  tags                  text[] not null default '{}',
  source                text,
  status                text not null default 'active' check (status in ('active','archived')),
  household_id          uuid references households(id) on delete set null,
  agency_partnership_id uuid references agency_partnerships(id) on delete set null,
  ghl_contact_id        text,                        -- link if also synced to GHL
  address               text,
  city                  text,
  state                 text default 'TX',
  zip                   text,
  notes                 text,
  owner_scope           uuid,                        -- owning FSA user (book scope)
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  deleted_at            timestamptz
);

create index if not exists idx_contacts_email_lc     on contacts(email_lc)     where email_lc is not null and deleted_at is null;
create index if not exists idx_contacts_phone_digits on contacts(phone_digits) where phone_digits is not null and deleted_at is null;
create index if not exists idx_contacts_type         on contacts(contact_type)  where deleted_at is null;
create index if not exists idx_contacts_status       on contacts(status)        where deleted_at is null;
create index if not exists idx_contacts_tags         on contacts using gin(tags);
create index if not exists idx_contacts_fullname     on contacts(lower(full_name));
create index if not exists idx_contacts_household    on contacts(household_id);
create index if not exists idx_contacts_agency       on contacts(agency_partnership_id);

drop trigger if exists contacts_updated_at on contacts;
create trigger contacts_updated_at before update on contacts
  for each row execute function update_updated_at();

-- Duplicate detection: contacts sharing a normalized email or phone.
create or replace view v_contact_duplicates
with (security_invoker = true) as
select email_lc as match_key, 'email'::text as match_on, count(*) as dup_count, array_agg(id) as contact_ids
from contacts
where deleted_at is null and email_lc is not null and email_lc <> ''
group by email_lc having count(*) > 1
union all
select phone_digits as match_key, 'phone'::text as match_on, count(*) as dup_count, array_agg(id) as contact_ids
from contacts
where deleted_at is null and phone_digits is not null and length(phone_digits) >= 7
group by phone_digits having count(*) > 1;

-- RLS — default-deny; read for FSA/staff/admin/compliance/super. Writes via
-- service role after rbac (service role bypasses RLS, so no write policy needed).
alter table contacts enable row level security;

drop policy if exists contacts_read on contacts;
create policy contacts_read on contacts for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
