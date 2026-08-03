-- 091_link_book_members_to_contacts.sql
-- Data repair (forward-only, idempotent). The in-force book importer created, for each person,
-- BOTH a household_members row (name + relationship + phone; no email, no source_contact_id) and
-- a contacts row (name + email + phone + household_id + tags) — without ever linking the two. As
-- a result ~5,953 members have no source_contact_id, so the tag-driven consent tools (which reach
-- members THROUGH contacts.tags -> household_members.source_contact_id) can't grant them consent
-- and the send-gate can't find their consent. This backfills that missing link.
--
-- Repair rule (deterministic + safe): set household_members.source_contact_id = contacts.id where
-- they share the SAME household and the SAME normalized full_name, the member is currently
-- UNLINKED, and the match is unambiguous (a member matched by >1 distinct contact — same name
-- twice in one household — is EXCLUDED and left for manual review). It creates nothing, deletes
-- nothing, and only fills a NULL column.
--
-- Idempotent: it only touches members whose source_contact_id IS NULL, so a re-run links 0.
-- Reversible: unset source_contact_id for members whose value equals this deterministic match.
-- Audited: one append-only audit_log row records the count + method (§13.9).
--
-- NOTE: this does NOT touch Life Conversion contacts whose household has no member (need a member
-- CREATED) or whose member name doesn't match (need reconciliation) — those are handled separately.

do $$
declare
  v_linked integer := 0;
begin
  with pairs as (
    select c.id as contact_id, hm.id as member_id
    from contacts c
    join household_members hm
      on hm.household_id = c.household_id
     and lower(trim(hm.full_name)) = lower(trim(c.full_name))
     and hm.source_contact_id is null
    where c.deleted_at is null
      and c.household_id is not null
      and coalesce(trim(c.full_name), '') <> ''
  ),
  clean as (
    -- keep only members that match exactly ONE distinct contact (drop same-name ambiguity)
    select member_id, (array_agg(contact_id order by contact_id))[1] as contact_id
    from pairs
    where member_id in (
      select member_id from pairs group by member_id having count(distinct contact_id) = 1
    )
    group by member_id
  ),
  upd as (
    update household_members hm
    set source_contact_id = clean.contact_id
    from clean
    where hm.id = clean.member_id
      and hm.source_contact_id is null
    returning hm.id
  )
  select count(*) into v_linked from upd;

  if to_regclass('public.audit_log') is not null then
    insert into audit_log (actor, action, entity, entity_id, diff)
    values (
      'system', 'config.changed', 'household_members', null,
      jsonb_build_object(
        'event', 'book_member_contact_link_repair',
        'migration', '091_link_book_members_to_contacts',
        'method', 'exact normalized name within same household; unlinked members only; same-name ambiguity excluded',
        'members_linked', v_linked,
        'reversible', 'unset source_contact_id for members whose value equals the deterministic name-within-household match'
      )
    );
  end if;

  raise notice 'Link repair 091: % household_members linked to their contact.', v_linked;
end $$;
