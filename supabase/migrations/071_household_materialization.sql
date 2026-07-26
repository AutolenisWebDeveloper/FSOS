-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Household materialization (contact → household spine)
-- Migration: 071_household_materialization
--
-- Slice 3 (the enrollment unlock). Adds the two idempotency anchors the
-- materialization service uses to connect orphan contacts (contacts.household_id
-- IS NULL) into the household spine so the native campaign engine — which enrolls
-- household_members.member_id — can reach them:
--
--   • households.origin_key         — deterministic grouping key for households
--     auto-materialized from contacts (hh:{lastname}|{street}|{zip}, or
--     hh:solo:{contact_id} when there is no usable address). Unique so a re-run or
--     the import path REUSES the existing household instead of spawning a parallel
--     one — people who share a household (same last name + address) group into one.
--   • household_members.source_contact_id — the contact↔member link. Unique so a
--     contact is materialized to at most one member (idempotent re-import), and so
--     Slice 5 can enroll a CONTACT segment through the member-keyed engine without a
--     fragile name-join.
--
-- Both are additive + nullable + forward-only: existing rows (book-imported
-- households, manually-entered members) keep NULL and are untouched. No data
-- rewrite. Rationale: docs/adr/ADR-029-household-materialization.md. Idempotent.
-- ═══════════════════════════════════════════════════════════════════

-- ── households.origin_key — deterministic grouping key ───────────────────────
alter table households add column if not exists origin_key text;

-- Unique only where set: contact-materialized households carry a key; all existing
-- households (origin_key NULL) are exempt and never collide.
create unique index if not exists uq_households_origin_key
  on households(origin_key)
  where origin_key is not null;

-- ── household_members.source_contact_id — contact↔member link ────────────────
alter table household_members
  add column if not exists source_contact_id uuid references contacts(id) on delete set null;

create unique index if not exists uq_household_members_source_contact
  on household_members(source_contact_id)
  where source_contact_id is not null;

-- Lookup index for the (household_id, lower(full_name)) secondary dedupe guard the
-- materializer and the existing conversions importer both use.
create index if not exists idx_household_members_hh_name
  on household_members(household_id, lower(full_name));

-- ── Refine the consolidation report (ADR-028 view) for materialization ───────
-- After Slice 3, agency_owner/business contacts stay household-orphaned by design
-- (they link to agency_partnerships, not households). Split the orphan count so the
-- surface shows the number that actually blocks enrollment (client-eligible) apart
-- from the B2B remainder. The two new columns are APPENDED AT THE END: CREATE OR
-- REPLACE VIEW only allows adding columns after the existing ones (renaming/reordering
-- errors with 42P16), and consumers select by name so order is irrelevant to them.
create or replace view v_contact_consolidation
with (security_invoker = true) as
select
  count(*)                                              as total,
  count(*) filter (where household_id is null)          as orphaned,
  count(*) filter (where household_id is not null)      as linked,
  count(*) filter (where email_lc is not null)          as with_email,
  count(*) filter (where phone_digits is not null)      as with_phone,
  count(*) filter (where email_lc is null
                     and phone_digits is null)          as unreachable,
  count(*) filter (where contact_type <> 'unknown')     as typed,
  count(*) filter (where contact_type = 'unknown')      as untyped,
  count(*) filter (where status = 'active')             as active,
  count(*) filter (where status = 'archived')           as archived,
  count(*) filter (where household_id is null
                     and contact_type in
                       ('client','prospect','cross_sell','term_conversion','unknown'))
                                                        as orphaned_eligible,
  count(*) filter (where household_id is null
                     and contact_type in ('agency_owner','business'))
                                                        as orphaned_ineligible
from contacts
where deleted_at is null;
