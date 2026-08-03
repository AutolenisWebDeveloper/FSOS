-- 092_conversion_members_reachability.sql
-- Data repair (forward-only, idempotent). Companion to 091. The Life Conversion import (contacts
-- tagged 'term-conversion' / 'life-conversion' / 'life conversion') left ~1,689 contacts with no
-- reachable household_members row, so the member-keyed consent tools and the send-gate can't see
-- them. 091 already linked every EXACT same-household name match; this migration handles the two
-- remaining, harder cases so the cohort becomes reachable:
--
--   PART A — LINK (same person, name variation). An unlinked member exists in the contact's
--     household whose FIRST + LAST name match the contact but whose middle name/initial/suffix
--     differs (e.g. contact "Adam Lusk" vs member "Adam Nicholas Lusk"). Set the member's
--     source_contact_id = contacts.id. STRICT 1:1 ONLY: the pair is applied only when that member
--     matches exactly one such contact AND that contact matches exactly one such member. Because
--     household_members.source_contact_id carries a UNIQUE index (071), enforcing 1:1 in BOTH
--     directions keeps the link safe even if future data introduces duplicates — a many-side match
--     is excluded and left for manual review rather than risking a unique-violation rollback.
--
--   PART B — CREATE (different person, or no member at all). The contact has no member to link to:
--     either the household's only unlinked member is a DIFFERENT person (the insured is a spouse/
--     relative — e.g. contact "Adam B Madrid" vs member "Miriam C Madrid"), or the household has no
--     member row at all. Linking to someone else would misattribute the contact's consent/identity,
--     so instead create a NEW household_members row for the contact (full_name/email/phone copied
--     from the contact, relationship 'primary'), linked via source_contact_id.
--
-- Creates members only for conversion contacts that have a household and are still unlinked after
-- Part A. Deletes nothing. Idempotent: Part A only fills NULL source_contact_id; Part B only creates
-- where no member is linked to the contact (source_contact_id is UNIQUE), so a re-run links/creates 0.
-- Reversible: unset source_contact_id for members linked here; soft-delete members created here
-- (they carry source_contact_id to a conversion-tagged contact and were created by this migration).
-- Audited: append-only audit_log rows record counts + method (action 'import.committed', §13.9),
-- matching the data-backfill precedent in 073_calendly_decommission_reconcile.sql.
--
-- Consent for this now-reachable cohort is granted separately as an attested, audited operation
-- (same existing-FNWL-policyholder basis as the District Book), NOT in this structural migration.

do $$
declare
  v_linked  integer := 0;
  v_created integer := 0;
begin
  ------------------------------------------------------------------
  -- PART A: link existing unlinked members by first+last name (strict 1:1)
  ------------------------------------------------------------------
  with conv as (
    select c.id as contact_id, c.household_id,
      lower(regexp_replace(trim(c.full_name), '\s+', ' ', 'g')) as nn
    from contacts c
    where c.deleted_at is null
      and c.household_id is not null
      and coalesce(trim(c.full_name), '') <> ''
      and exists (
        select 1 from unnest(c.tags) t
        where lower(trim(t)) in ('term-conversion', 'life-conversion', 'life conversion')
      )
      and not exists (
        select 1 from household_members hm where hm.source_contact_id = c.id
      )
  ),
  pairs as (
    select cv.contact_id, hm.id as member_id
    from conv cv
    join household_members hm
      on hm.household_id = cv.household_id
     and hm.source_contact_id is null
     and split_part(lower(regexp_replace(trim(hm.full_name), '\s+', ' ', 'g')), ' ', 1)
         = split_part(cv.nn, ' ', 1)
     and reverse(split_part(reverse(lower(regexp_replace(trim(hm.full_name), '\s+', ' ', 'g'))), ' ', 1))
         = reverse(split_part(reverse(cv.nn), ' ', 1))
    where coalesce(trim(hm.full_name), '') <> ''
  ),
  clean as (
    -- strict 1:1: keep only pairs where the member matches exactly one contact
    -- AND the contact matches exactly one member (both directions unambiguous)
    select p.member_id, p.contact_id
    from pairs p
    where p.member_id in (select member_id from pairs group by member_id having count(distinct contact_id) = 1)
      and p.contact_id in (select contact_id from pairs group by contact_id having count(distinct member_id) = 1)
  ),
  upd as (
    update household_members hm
    set source_contact_id = clean.contact_id,
        updated_at = now()
    from clean
    where hm.id = clean.member_id
      and hm.source_contact_id is null
    returning hm.id
  )
  select count(*) into v_linked from upd;

  ------------------------------------------------------------------
  -- PART B: create members for conversion contacts still unreachable
  ------------------------------------------------------------------
  with conv as (
    select c.id as contact_id, c.household_id, c.full_name, c.email, c.phone
    from contacts c
    where c.deleted_at is null
      and c.household_id is not null
      and coalesce(trim(c.full_name), '') <> ''
      and exists (
        select 1 from unnest(c.tags) t
        where lower(trim(t)) in ('term-conversion', 'life-conversion', 'life conversion')
      )
      and not exists (
        select 1 from household_members hm where hm.source_contact_id = c.id
      )
  ),
  ins as (
    insert into household_members (household_id, full_name, relationship, email, phone, source_contact_id)
    select cv.household_id, cv.full_name, 'primary', cv.email, cv.phone, cv.contact_id
    from conv cv
    returning id
  )
  select count(*) into v_created from ins;

  ------------------------------------------------------------------
  -- Audit (append-only)
  ------------------------------------------------------------------
  if to_regclass('public.audit_log') is not null then
    insert into audit_log (actor, action, entity, entity_id, diff)
    values (
      'system', 'import.committed', 'household_members', null,
      jsonb_build_object(
        'event', 'conversion_member_reachability_repair',
        'migration', '092_conversion_members_reachability',
        'members_linked', v_linked,
        'members_created', v_created,
        'link_method', 'first+last name within same household, unlinked members only, strict 1:1 both directions (unique-index safe)',
        'create_method', 'conversion-tagged contact with a household but no linked member (different-person or no-member households); relationship=primary; name/email/phone copied from contact',
        'reversible', 'unset source_contact_id for members linked here; soft-delete members created here (source_contact_id -> conversion-tagged contact)'
      )
    );
  end if;

  raise notice 'Conversion reachability 092: % members linked, % members created.', v_linked, v_created;
end $$;
