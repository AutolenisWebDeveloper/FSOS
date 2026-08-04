-- ─────────────────────────────────────────────────────────
-- Migration: 098_policy_search_fields
--
-- First-class Series Code + AOR Code on household_policies so Global Search (§11)
-- can resolve by them. These identifiers were only ever stored inside the
-- `source_data` JSONB (varying shapes: the conversion importer nests
-- source_data.conversion.aor_code; the in-force book importer keeps raw
-- header-keyed values). JSONB is not a reliable search target, so we promote them
-- to real columns, backfill best-effort from the known shapes, and index them.
-- Carrier and product/LOB are already first-class (carriers.name via carrier_id;
-- household_policies.product_name), so no new column is needed for those.
--
-- No invented data (§4.3): the backfill only copies values already present in
-- source_data; rows without a recognizable key stay null. Importers are updated
-- in the same change to populate the columns going forward.
--
-- Forward-only, idempotent; the runner applies the file atomically.
-- ─────────────────────────────────────────────────────────

alter table household_policies add column if not exists series_code text;
alter table household_policies add column if not exists aor_code    text;

-- Backfill AOR code from the two known source_data shapes (conversion sub-object
-- first, then raw header keys). Only fills nulls; never overwrites a real value.
update household_policies
set aor_code = nullif(trim(coalesce(
  source_data->'conversion'->>'aor_code',
  source_data->>'AOR Code',
  source_data->>'aor_code',
  source_data->>'Agency AOR'
)), '')
where aor_code is null
  and source_data is not null;

-- Backfill Series code from the raw header keys the in-force book importer stores.
update household_policies
set series_code = nullif(trim(coalesce(
  source_data->>'Series Code',
  source_data->>'series_code',
  source_data->'conversion'->>'series_code'
)), '')
where series_code is null
  and source_data is not null;

-- Search indexes — partial on live rows so soft-deleted policies never scan.
create index if not exists idx_hpolicies_series_code on household_policies (series_code) where deleted_at is null and series_code is not null;
create index if not exists idx_hpolicies_aor_code    on household_policies (aor_code)    where deleted_at is null and aor_code    is not null;
