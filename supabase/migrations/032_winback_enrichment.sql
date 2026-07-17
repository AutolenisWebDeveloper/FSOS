-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Win-Back Life enrichment (former life households to re-engage)
-- Migration: 032_winback_enrichment
--
-- The Win-Back Life import matches a Farmers "win-back" list (households whose
-- agency previously had a Life line that is now inactive, i.e. lapsed/left)
-- against the existing Contact Center and, using the shared entity-resolution
-- engine, ENRICHES a matched contact in place — never overwriting valid data —
-- queues an ambiguous match for manual review, or creates a new contact when
-- there is no reliable match. One additive, idempotent column supports it:
--
--   • winback_key  — provenance key the importer matches/upserts on, so re-running
--                    the same list never duplicates a contact. Mirrors
--                    crosssell_key; both are surfaced to the resolution engine as
--                    same-record provenance keys.
--
-- GUARDRAILS: these are property/casualty + lapsed-life households — a green-zone
-- "identify" signal for life re-engagement. Nothing here is flagged is_security
-- and no product/policy recommendation is implied. The inactive/active lines of
-- business are captured in `lines_of_business` (already present) for context only.
--
-- Idempotent; nothing dropped or renamed.
-- ═══════════════════════════════════════════════════════════════════

alter table contacts add column if not exists winback_key text;

create unique index if not exists uq_contacts_winback_key
  on contacts(winback_key) where winback_key is not null;
