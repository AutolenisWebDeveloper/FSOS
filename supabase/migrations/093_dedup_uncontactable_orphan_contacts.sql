-- 093_dedup_uncontactable_orphan_contacts.sql
-- Data-quality cleanup (forward-only, idempotent). The in-force book import left a small tail of
-- duplicate contact rows that are BOTH uncontactable and unusable: no household (household_id IS
-- NULL), no email, and no phone — several appearing 2-3x for the same person (e.g. one name x3).
-- They can never receive outreach and are linked to nothing, so the duplicates are pure import
-- noise. This soft-deletes the redundant copies, keeping one canonical row per name.
--
-- Scope (deliberately narrow — only provably-safe rows):
--   * contacts with deleted_at IS NULL, household_id IS NULL, no email AND no phone;
--   * that fall in a duplicate group (same normalized full_name appears >1x within that set).
-- Keeper per group: prefer a referenced row (defensive — there are none today), then earliest
-- created_at, then lowest id. Every OTHER row in the group is soft-deleted ONLY IF it is not
-- referenced by any FK (agency_owners, appointments, household_members.source_contact_id,
-- household_policies, opportunities, pipeline_winback_enrollments). A referenced duplicate is left
-- untouched for manual review rather than hidden while still in use.
--
-- Soft-delete only (sets deleted_at) — never a hard delete, so FK integrity is preserved and the
-- action is reversible (clear deleted_at). Idempotent: soft-deleted rows drop out of the candidate
-- set, so a re-run deletes 0. Audited: one append-only audit_log row (action 'import.committed',
-- matching the data-repair precedent in 073 / 091 / 092).
--
-- Not in scope: contactable duplicates, rows with a household, or agency-directory/staff contacts —
-- none of those are touched here.

do $$
declare
  v_deleted integer := 0;
begin
  with cand as (
    select c.id,
      lower(regexp_replace(trim(coalesce(c.full_name,'')), '\s+', ' ', 'g')) as nn,
      c.created_at,
      (exists(select 1 from agency_owners x where x.contact_id = c.id)
        or exists(select 1 from appointments x where x.contact_id = c.id)
        or exists(select 1 from household_members x where x.source_contact_id = c.id)
        or exists(select 1 from household_policies x where x.contact_id = c.id)
        or exists(select 1 from opportunities x where x.contact_id = c.id)
        or exists(select 1 from pipeline_winback_enrollments x where x.contact_id = c.id)) as referenced
    from contacts c
    where c.deleted_at is null
      and c.household_id is null
      and (c.email is null or c.email = '')
      and (c.phone is null or c.phone = '')
      and coalesce(trim(c.full_name), '') <> ''
  ),
  dup as (select nn from cand group by nn having count(*) > 1),
  ranked as (
    select cand.id, cand.referenced,
      row_number() over (partition by cand.nn
        order by cand.referenced desc, cand.created_at asc, cand.id asc) as rn
    from cand join dup using (nn)
  ),
  del as (
    update contacts c
    set deleted_at = now(), updated_at = now()
    from ranked
    where c.id = ranked.id
      and ranked.rn > 1            -- keep the canonical row per name group
      and ranked.referenced = false -- never hide a duplicate that is still referenced
      and c.deleted_at is null
    returning c.id
  )
  select count(*) into v_deleted from del;

  if to_regclass('public.audit_log') is not null then
    insert into audit_log (actor, action, entity, entity_id, diff)
    values (
      'system', 'import.committed', 'contacts', null,
      jsonb_build_object(
        'event', 'uncontactable_orphan_contact_dedup',
        'migration', '093_dedup_uncontactable_orphan_contacts',
        'contacts_soft_deleted', v_deleted,
        'scope', 'household_id IS NULL, no email, no phone, duplicate normalized full_name; unreferenced non-keepers only',
        'keeper_rule', 'prefer referenced, then earliest created_at, then lowest id',
        'method', 'soft-delete (deleted_at set); reversible by clearing deleted_at'
      )
    );
  end if;

  raise notice 'Dedup 093: % uncontactable orphan duplicate contacts soft-deleted.', v_deleted;
end $$;
