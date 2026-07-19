-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Policy ↔ Contact ↔ Agency association (automatic, every import)
-- Migration: 030_policy_association
--
-- Requirement: every policy must be associated with the correct CONTACT and
-- AGENCY using all available identifiers (policy number, agency name, agency
-- number, agent number), and this must happen automatically for every contact
-- and policy imported — no matter which importer wrote the row.
--
-- Until now a policy reached its agency/contact only transitively through the
-- household. This migration:
--   1. adds DIRECT links household_policies.agency_partnership_id + contact_id;
--   2. installs triggers that resolve those links on every INSERT/UPDATE, so
--      the association is enforced at the data layer for the District Book,
--      Cross-Sell, Life Conversion, and Contact imports alike;
--   3. backfills the existing book.
--
-- Resolution is multi-identifier and NEVER overwrites a value already set:
--   • agency  ← agent number  (source_data 'Serving Agent Number' = fnwl_serving_agent_no)
--              ← agency number (source_data 'Agency Number' = legacy_agency_id)
--              ← agency name   (source_data 'Serving Agent Name'/'Agency Name' = agency_name)
--              ← the household's referring agency (fallback)
--   • contact ← the household's owner contact (book provenance preferred)
-- Term/whole-life policies only touch these links; no securities data is added.
-- Idempotent; nothing dropped or renamed.
-- ═══════════════════════════════════════════════════════════════════

alter table household_policies add column if not exists agency_partnership_id uuid references agency_partnerships(id);
alter table household_policies add column if not exists contact_id uuid references contacts(id);

create index if not exists idx_hp_agency   on household_policies(agency_partnership_id) where deleted_at is null;
create index if not exists idx_hp_contact  on household_policies(contact_id)            where deleted_at is null;

-- ── resolver helpers ─────────────────────────────────────────────────────────
create or replace function fsos_resolve_policy_agency(p_source jsonb, p_household uuid)
returns uuid language plpgsql stable as $$
declare v uuid; v_key text;
begin
  -- agent number
  v_key := nullif(p_source->>'Serving Agent Number', '');
  if v_key is not null then
    select id into v from agency_partnerships where fnwl_serving_agent_no = v_key and deleted_at is null limit 1;
    if v is not null then return v; end if;
  end if;
  -- agency number (future-proof; maps to the legacy agency id when present)
  v_key := coalesce(nullif(p_source->>'Agency Number',''), nullif(p_source->>'Agency No',''));
  if v_key is not null then
    select id into v from agency_partnerships where legacy_agency_id = v_key and deleted_at is null limit 1;
    if v is not null then return v; end if;
  end if;
  -- agency name / serving agent name
  v_key := coalesce(nullif(p_source->>'Agency Name',''), nullif(p_source->>'Serving Agent Name',''));
  if v_key is not null then
    select id into v from agency_partnerships where lower(agency_name) = lower(v_key) and deleted_at is null limit 1;
    if v is not null then return v; end if;
  end if;
  -- household fallback
  if p_household is not null then
    select referring_agency_id into v from households where id = p_household;
  end if;
  return v;
end $$;

create or replace function fsos_resolve_household_owner(p_household uuid)
returns uuid language plpgsql stable as $$
declare v uuid;
begin
  if p_household is null then return null; end if;
  select c.id into v from contacts c
   where c.household_id = p_household and c.deleted_at is null
   order by (c.book_key like 'owner:%') desc, (c.contact_type in ('client','agency_owner')) desc, c.created_at asc
   limit 1;
  return v;
end $$;

-- ── triggers: resolve links on write (only when unset — never overwrite) ─────
create or replace function fsos_link_policy() returns trigger language plpgsql as $$
begin
  if NEW.agency_partnership_id is null then
    NEW.agency_partnership_id := fsos_resolve_policy_agency(NEW.source_data, NEW.household_id);
  end if;
  if NEW.contact_id is null then
    NEW.contact_id := fsos_resolve_household_owner(NEW.household_id);
  end if;
  return NEW;
end $$;
drop trigger if exists trg_link_policy on household_policies;
create trigger trg_link_policy before insert or update on household_policies
  for each row execute function fsos_link_policy();

-- Contacts get their serving agency from the household on write.
create or replace function fsos_link_contact() returns trigger language plpgsql as $$
begin
  if NEW.agency_partnership_id is null and NEW.household_id is not null then
    select referring_agency_id into NEW.agency_partnership_id from households where id = NEW.household_id;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_link_contact on contacts;
create trigger trg_link_contact before insert or update on contacts
  for each row execute function fsos_link_contact();

-- When an owner contact appears (imports write contacts AFTER their policies),
-- claim that household's still-unlinked policies. Owner/known types only.
create or replace function fsos_backfill_policy_contact() returns trigger language plpgsql as $$
begin
  if NEW.household_id is not null
     and (NEW.book_key like 'owner:%' or NEW.contact_type in ('client','agency_owner')) then
    update household_policies
       set contact_id = NEW.id
     where household_id = NEW.household_id and contact_id is null and deleted_at is null;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_backfill_policy_contact on contacts;
create trigger trg_backfill_policy_contact after insert on contacts
  for each row execute function fsos_backfill_policy_contact();

-- ── one-time backfill of the existing book ───────────────────────────────────
update household_policies hp
   set agency_partnership_id = fsos_resolve_policy_agency(hp.source_data, hp.household_id)
 where hp.deleted_at is null
   and hp.agency_partnership_id is null
   and fsos_resolve_policy_agency(hp.source_data, hp.household_id) is not null;

update household_policies hp
   set contact_id = fsos_resolve_household_owner(hp.household_id)
 where hp.deleted_at is null
   and hp.contact_id is null
   and fsos_resolve_household_owner(hp.household_id) is not null;

update contacts c
   set agency_partnership_id = h.referring_agency_id
  from households h
 where c.household_id = h.id
   and c.agency_partnership_id is null
   and h.referring_agency_id is not null
   and c.deleted_at is null;
