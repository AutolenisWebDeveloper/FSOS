-- ─────────────────────────────────────────────────────────
-- Migration: 046_opportunity_contact
--
-- AI Revenue Command Center — Life Win-Back slice (§13.2). Adds a nullable contact
-- linkage to opportunities so a former life client (an imported win-back contact that
-- may not yet be resolved to a household) can become a tracked, ATTRIBUTED,
-- deduplicated pipeline opportunity (lib/opportunities/winback.ts + originate.ts).
--
-- contact_id is the attribution key when there is no household yet, and the dedup key
-- for "one open win_back opportunity per contact". It is a SUPPORTING index only — the
-- aggregate root stays the agency partnership (ADR-001); opportunities still carry
-- referring_agency_id + household_id. This does NOT promote contacts to a root.
--
-- Additive + idempotent + forward-only. Nullable FK, existing rows stay NULL (no
-- backfill), existing INSERT paths unaffected. RLS is inherited from the table
-- (opp_read, mig 010); no policy change. No securities data is stored here.
-- ─────────────────────────────────────────────────────────

alter table opportunities
  add column if not exists contact_id uuid references contacts(id) on delete set null;

comment on column opportunities.contact_id is
  'Optional supporting link to the originating contact (e.g. win-back). Attribution/dedup key when no household is resolved yet. Aggregate root stays the agency partnership (mig 046).';

-- Supports the win-back dedup lookup: open opportunities for a contact by source.
create index if not exists idx_opportunities_contact on opportunities(contact_id) where deleted_at is null;
