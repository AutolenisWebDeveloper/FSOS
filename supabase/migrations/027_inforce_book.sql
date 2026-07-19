-- ═══════════════════════════════════════════════════════════════════
-- FSOS — In-Force Book import (FNWL district review → App B aggregate root)
-- Migration: 027_inforce_book
--
-- Supports importing an FNWL "Review of in-force business" export onto the
-- aggregate-root spine: serving agents → agency_partnerships, owners →
-- households (+ members), each policy row → household_policies. Adds the
-- provenance keys the importer dedupes on (idempotent re-import) and the columns
-- needed to preserve the book's policy detail (product name, face amount,
-- accumulation value, and the raw source row for auditability).
-- Idempotent; nothing dropped or renamed. Confidential book data is protected by
-- the existing RLS on these tables.
-- ═══════════════════════════════════════════════════════════════════

-- Serving-agent provenance (dedupe agency partnerships across re-imports).
alter table agency_partnerships add column if not exists fnwl_serving_agent_no text;
create unique index if not exists uq_agency_partnerships_fnwl_agent
  on agency_partnerships(fnwl_serving_agent_no) where fnwl_serving_agent_no is not null;

-- Owner provenance (dedupe households by a normalized owner key).
alter table households add column if not exists book_owner_key text;
create unique index if not exists uq_households_book_owner
  on households(book_owner_key) where book_owner_key is not null;

-- Policy detail preserved from the book + provenance for idempotent re-import.
alter table household_policies add column if not exists product_name       text;
alter table household_policies add column if not exists face_amount         numeric(14,2);
alter table household_policies add column if not exists accumulation_value  numeric(14,2);
alter table household_policies add column if not exists source_system       text;
alter table household_policies add column if not exists source_data         jsonb;

-- One policy per FNWL policy number (idempotent re-import).
create unique index if not exists uq_household_policies_fnwl_number
  on household_policies(policy_number) where source_system = 'fnwl' and policy_number is not null;

create index if not exists idx_household_policies_source on household_policies(source_system);
