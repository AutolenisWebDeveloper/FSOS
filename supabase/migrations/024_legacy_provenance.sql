-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Legacy→App B data migration: provenance keys (Milestone 4, part 1)
-- Migration: 024_legacy_provenance
--
-- Adds the provenance columns the full legacy backfill (025) keys on, so the ETL
-- is idempotent and re-runnable and a row's App B record can always be traced to
-- the legacy row it came from. Mirrors the households.legacy_customer_id column
-- already added for the OPRA backfill (022).
-- Idempotent; nothing dropped or renamed; App A tables untouched.
-- ═══════════════════════════════════════════════════════════════════

alter table agency_partnerships add column if not exists legacy_agency_id  text;
alter table household_members   add column if not exists legacy_customer_id uuid;
alter table household_policies   add column if not exists legacy_policy_id  uuid;
alter table referrals            add column if not exists legacy_referral_id uuid;
alter table commissions          add column if not exists legacy_case_id    uuid;

create unique index if not exists uq_agency_partnerships_legacy
  on agency_partnerships(legacy_agency_id) where legacy_agency_id is not null;
create unique index if not exists uq_household_members_legacy_customer
  on household_members(legacy_customer_id) where legacy_customer_id is not null;
create unique index if not exists uq_household_policies_legacy
  on household_policies(legacy_policy_id) where legacy_policy_id is not null;
create unique index if not exists uq_referrals_legacy
  on referrals(legacy_referral_id) where legacy_referral_id is not null;
create unique index if not exists uq_commissions_legacy
  on commissions(legacy_case_id) where legacy_case_id is not null;
