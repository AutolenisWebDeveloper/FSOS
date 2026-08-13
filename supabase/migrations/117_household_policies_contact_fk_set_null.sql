-- ═══════════════════════════════════════════════════════════════════
-- FSOS — household_policies.contact_id FK → ON DELETE SET NULL
-- Migration: 117_household_policies_contact_fk_set_null
--
-- The Contact Center now permanently (hard) deletes contacts. Every FK into
-- contacts(id) is ON DELETE SET NULL (booking, opportunities, agency_owners,
-- household_members.source_contact_id, campaign staging) or ON DELETE CASCADE
-- (comm_suppression) — EXCEPT household_policies.contact_id, which migration 030
-- added with no on-delete clause. That defaults to NO ACTION (restrict), so a
-- hard delete of a contact that a policy points at fails with:
--   update or delete on table "contacts" violates foreign key constraint
--   "household_policies_contact_id_fkey" on table "household_policies"
--
-- household_policies is a HOUSEHOLD-owned record; contact_id is an OPTIONAL
-- convenience link (030) resolved by the policy-association triggers, not the
-- policy's identity. Detaching that link when the contact is deleted is correct
-- and matches every other contact FK — the policy row (and its household link)
-- is untouched. Convert the constraint to ON DELETE SET NULL.
--
-- Idempotent: drops the existing FK on (household_policies.contact_id → contacts)
-- by introspection, then recreates it as SET NULL under the canonical name.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  c record;
begin
  -- Drop any FK constraint on household_policies.contact_id that targets contacts,
  -- whatever its current name / on-delete action (canonical name is
  -- household_policies_contact_id_fkey, but resolve it defensively).
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel        on rel.oid = con.conrelid
    join pg_namespace nsp    on nsp.oid = rel.relnamespace
    join pg_class frel       on frel.oid = con.confrelid
    where con.contype = 'f'
      and nsp.nspname = 'public'
      and rel.relname = 'household_policies'
      and frel.relname = 'contacts'
      and (
        select attname from pg_attribute
        where attrelid = con.conrelid and attnum = con.conkey[1]
      ) = 'contact_id'
  loop
    execute format('alter table household_policies drop constraint %I', c.conname);
  end loop;

  -- Recreate as ON DELETE SET NULL under the canonical name.
  alter table household_policies
    add constraint household_policies_contact_id_fkey
    foreign key (contact_id) references contacts(id) on delete set null;
end $$;
