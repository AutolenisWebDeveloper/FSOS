-- ─────────────────────────────────────────────────────────
-- Migration: 045_opportunity_source
--
-- AI Revenue Command Center — Cross-Sell slice (§13.1). Adds an explicit
-- origination-provenance tag to opportunities so a detected coverage gap can become a
-- tracked, ATTRIBUTED, deduplicated pipeline opportunity (lib/opportunities/crosssell.ts
-- + originate.ts). Provenance is the attribution key the initiative requires (§28) and
-- the dedup key for "one open cross-sell opportunity per household".
--
-- Additive + idempotent + forward-only. A nullable text column — existing rows stay
-- NULL (no backfill), existing INSERT paths (referral convert, review outcome, manual
-- create) are unaffected and may adopt it later. RLS is inherited from the table
-- (opp_read, mig 010); no policy change. No securities data is stored here.
-- ─────────────────────────────────────────────────────────

alter table opportunities
  add column if not exists source text;

comment on column opportunities.source is
  'Origination provenance for attribution (e.g. cross_sell, referral, review, manual). Nullable; additive (mig 045).';

-- Supports the cross-sell dedup lookup: open opportunities for a household by source.
create index if not exists idx_opportunities_source on opportunities(source) where deleted_at is null;
