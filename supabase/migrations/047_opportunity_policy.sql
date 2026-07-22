-- ─────────────────────────────────────────────────────────
-- Migration: 047_opportunity_policy
--
-- AI Revenue Command Center — Term Conversion slice (§13.3). Adds a nullable policy
-- linkage to opportunities so a convertible term policy's conversion window can become
-- a tracked, ATTRIBUTED, deduplicated pipeline opportunity
-- (lib/opportunities/termconversion.ts + originate.ts).
--
-- policy_id is the attribution key (which policy is converting) and the dedup key for
-- "one open term_conversion opportunity per policy". It is a SUPPORTING link — the
-- aggregate root stays the agency partnership (ADR-001); opportunities still carry
-- household_id + product_id. Completes the origination-attribution trio: source (045),
-- contact_id (046), policy_id (047).
--
-- Additive + idempotent + forward-only. Nullable FK, existing rows stay NULL (no
-- backfill), existing INSERT paths unaffected. RLS inherited from the table (opp_read,
-- mig 010); no policy change. No securities data is stored here (securities policies are
-- excluded from origination by the firewall, never linked).
-- ─────────────────────────────────────────────────────────

alter table opportunities
  add column if not exists policy_id uuid references household_policies(id) on delete set null;

comment on column opportunities.policy_id is
  'Optional supporting link to the originating policy (e.g. term conversion). Attribution/dedup key per policy. Aggregate root stays the agency partnership (mig 047).';

-- Supports the term-conversion dedup lookup: open opportunities for a policy by source.
create index if not exists idx_opportunities_policy on opportunities(policy_id) where deleted_at is null;
