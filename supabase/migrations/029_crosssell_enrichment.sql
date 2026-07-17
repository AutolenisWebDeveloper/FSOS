-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Cross-Sell enrichment (Auto/Home/Umbrella P&C households, No Life)
-- Migration: 029_crosssell_enrichment
--
-- The Cross-Sell import matches a Farmers P&C book (Salesforce export) against
-- the existing Contact Center and ENRICHES matched contacts in place — never
-- overwriting valid data — or creates a new `cross_sell` contact when there is
-- no match. Two additive, idempotent columns support this:
--
--   • crosssell_key      — provenance key the importer matches/upserts on, so
--                          re-running the same list never duplicates a contact.
--   • lines_of_business  — the P&C lines that make the household a life cross-
--                          sell target (Auto, Home, Umbrella, Flood, …). These
--                          are property/casualty lines, NOT securities: nothing
--                          here is flagged is_security and no product advice is
--                          implied (green-zone "identify" only).
--
-- Idempotent; nothing dropped or renamed.
-- ═══════════════════════════════════════════════════════════════════

alter table contacts add column if not exists crosssell_key text;
alter table contacts add column if not exists lines_of_business text[] not null default '{}';

create unique index if not exists uq_contacts_crosssell_key
  on contacts(crosssell_key) where crosssell_key is not null;

create index if not exists idx_contacts_lob
  on contacts using gin (lines_of_business) where deleted_at is null;
