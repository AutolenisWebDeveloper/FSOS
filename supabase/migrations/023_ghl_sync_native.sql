-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Native GoHighLevel sync (App A → App B parity, Milestone 2)
-- Migration: 023_ghl_sync_native
--
-- App A pushed records into GoHighLevel from the legacy customers/agencies
-- tables, storing the returned GHL ids back on the row (ghl_contact_id,
-- ghl_opportunity_id) for idempotent re-sync. This rebuilds that natively on the
-- App B spine by adding the same id columns to the App B records that map to the
-- two sync modes:
--   • households          → prospect_client pipeline (a prospect/client contact)
--   • agency_partnerships → agency_owner pipeline    (an agency-owner contact)
-- The GHL client library (lib/ghl.ts) is schema-agnostic and unchanged.
-- Idempotent: safe to re-run. Nothing dropped or renamed; App A untouched.
-- ═══════════════════════════════════════════════════════════════════

alter table households add column if not exists ghl_contact_id     text;
alter table households add column if not exists ghl_opportunity_id text;
alter table households add column if not exists ghl_synced_at       timestamptz;

alter table agency_partnerships add column if not exists ghl_contact_id     text;
alter table agency_partnerships add column if not exists ghl_opportunity_id text;
alter table agency_partnerships add column if not exists ghl_synced_at       timestamptz;

create index if not exists idx_households_ghl_contact
  on households(ghl_contact_id) where ghl_contact_id is not null;
create index if not exists idx_agency_partnerships_ghl_contact
  on agency_partnerships(ghl_contact_id) where ghl_contact_id is not null;
