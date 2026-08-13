-- ═══════════════════════════════════════════════════════════════════
-- FSOS — household_policies.agency_partnership_id FK → ON DELETE SET NULL
-- Migration: 118_household_policies_agency_fk_set_null
--
-- Agency partnerships can now be permanently (hard) deleted from the directory.
-- Every FK into agency_partnerships(id) is ON DELETE SET NULL (households,
-- contacts, opportunities, commissions, referrals, comm_*) or ON DELETE CASCADE
-- (agency_owners, agency_activation, delegations, commission_splits,
-- district_nurture_enrollments, user_agencies, comm_agency_suppressions) — EXCEPT
-- household_policies.agency_partnership_id, which migration 030 added with no
-- on-delete clause. That defaults to NO ACTION (restrict), so a hard delete of an
-- agency that a policy points at fails with:
--   update or delete on table "agency_partnerships" violates foreign key constraint
--   "household_policies_agency_partnership_id_fkey" on table "household_policies"
--
-- This mirrors migration 117 (the sibling contact_id link). household_policies is a
-- HOUSEHOLD-owned record; agency_partnership_id is an OPTIONAL convenience link (030)
-- resolved by the policy-association triggers, not the policy's identity. Detaching
-- it when the agency is deleted is correct and matches every other agency FK — the
-- policy row (and its household link) is untouched. Convert to ON DELETE SET NULL.
--
-- Idempotent: drops the existing FK on (household_policies.agency_partnership_id →
-- agency_partnerships) by introspection, then recreates it as SET NULL.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel        on rel.oid = con.conrelid
    join pg_namespace nsp    on nsp.oid = rel.relnamespace
    join pg_class frel       on frel.oid = con.confrelid
    where con.contype = 'f'
      and nsp.nspname = 'public'
      and rel.relname = 'household_policies'
      and frel.relname = 'agency_partnerships'
      and (
        select attname from pg_attribute
        where attrelid = con.conrelid and attnum = con.conkey[1]
      ) = 'agency_partnership_id'
  loop
    execute format('alter table household_policies drop constraint %I', c.conname);
  end loop;

  alter table household_policies
    add constraint household_policies_agency_partnership_id_fkey
    foreign key (agency_partnership_id) references agency_partnerships(id) on delete set null;
end $$;
