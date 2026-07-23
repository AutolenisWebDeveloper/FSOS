-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Agency Directory bulk-import fields
-- Migration: 051_agency_directory_import
--
-- The FSA works from a Farmers agent directory (agent code, office address,
-- two phone numbers, and prospecting flags). The aggregate-root spine
-- (agency_partnerships / agency_owners, migration 009) had no home for those
-- columns, so a directory could only be entered one field-lossy record at a
-- time. This migration adds the missing owner-contact + office attributes so a
-- directory row round-trips without dropping data, and the batch importer
-- (/api/agencies/import) can create partnership+owner pairs.
--
-- All additive + idempotent. Nothing dropped, renamed, or made NOT NULL.
-- The Farmers agent number already has a home: agency_partnerships
-- .fnwl_serving_agent_no (migration 027) — reused here, not duplicated.
-- RLS is unchanged: reads stay governed by the existing ap_read policy
-- (migration 010); writes run through the service role in the import route.
-- ═══════════════════════════════════════════════════════════════════

-- ── Office location + prospecting flags on the agency (aggregate root) ───────
alter table agency_partnerships add column if not exists office_address      text;
alter table agency_partnerships add column if not exists office_city         text;
alter table agency_partnerships add column if not exists office_state        text;
alter table agency_partnerships add column if not exists office_zip          text;

-- Prospecting signals carried on the directory (not securities data): whether the
-- agency already uses the leads program, and whether they have expressed interest.
alter table agency_partnerships add column if not exists existing_leads_user boolean not null default false;
alter table agency_partnerships add column if not exists interested          boolean not null default false;

-- ── Second phone on the owner contact ───────────────────────────────────────
-- agency_owners.phone (009) holds the business/office line; mobile_phone holds
-- the cell. Both nullable — a directory row may carry either, both, or neither.
alter table agency_owners add column if not exists mobile_phone text;

-- ── Dedupe-lookup index ─────────────────────────────────────────────────────
-- The importer dedupes on the Farmers agent number (natural key) and falls back
-- to owner email. A non-unique index keeps that lookup cheap without imposing a
-- hard DB constraint that would break legitimate re-imports/updates or existing
-- rows; uniqueness is enforced in the importer (in-file + against-DB), matching
-- the contacts-importer pattern.
create index if not exists idx_agency_partnerships_fnwl_agent_no
  on agency_partnerships (fnwl_serving_agent_no)
  where fnwl_serving_agent_no is not null and deleted_at is null;

create index if not exists idx_agency_owners_email
  on agency_owners (lower(email))
  where email is not null;

-- ── Column documentation ────────────────────────────────────────────────────
comment on column agency_partnerships.office_address      is 'Directory: agency office street address (not securities data).';
comment on column agency_partnerships.office_city         is 'Directory: agency office city.';
comment on column agency_partnerships.office_state        is 'Directory: agency office state (2-letter, e.g. TX).';
comment on column agency_partnerships.office_zip          is 'Directory: agency office ZIP.';
comment on column agency_partnerships.existing_leads_user is 'Directory prospecting flag: agency already uses the leads program.';
comment on column agency_partnerships.interested          is 'Directory prospecting flag: agency has expressed interest in FSA partnership.';
comment on column agency_owners.mobile_phone             is 'Owner mobile/cell line; agency_owners.phone holds the business/office line.';

-- Import audit reuse: import_batches.source now also carries 'agency', and
-- import_records.entity_type also carries 'agency_partnership'. Both columns are
-- free-text (no CHECK constraint — see migration 031), so no constraint change
-- is required; this comment records the added vocabulary.
comment on column import_batches.source is 'importer: contacts | crosssell | conversion | book | agency';
comment on column import_records.entity_type is 'contact | policy | agency_partnership';
