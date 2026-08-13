-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Contact Center: index contacts.source for campaign filtering/deletion
-- Migration: 116_contacts_source_index
--
-- The Contact Center now lets an operator VIEW/FILTER and BULK-DELETE contacts by
-- campaign (the origin `source` stream — e.g. winback_life, cross_sell,
-- term_conversion, agency_directory), agency (agency_partnership_id, already
-- indexed by 026), and group (tags, already GIN-indexed by 026). `source` had no
-- index; a filter/delete-by-campaign over the full book would sequential-scan.
--
-- Add a partial index on source (live rows only) so the campaign filter and the
-- server-side bulk-delete-by-campaign resolve without a full scan. Idempotent;
-- nothing dropped or renamed.
-- ═══════════════════════════════════════════════════════════════════

create index if not exists idx_contacts_source
  on contacts(source)
  where source is not null and deleted_at is null;
