-- ═══════════════════════════════════════════════════════════════════
-- FSOS — GoHighLevel linkage for agency owners (Pipeline B)
-- Migration: 003_ghl_agency
-- Run in: Supabase → SQL Editor → New Query → paste → Run
--
-- Agency owners are tracked in the GHL "Agency Owner" pipeline
-- (lIUaJLNxFwtCJPycw70h). These columns tie an FSOS agency to its GHL owner
-- contact/opportunity so the Agency Owners page can show the live pilot →
-- active → strategic stage and /api/ghl/sync can push owners into Pipeline B.
-- Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════

alter table agencies add column if not exists ghl_contact_id text;
alter table agencies add column if not exists ghl_opportunity_id text;
alter table agencies add column if not exists ghl_stage_id text;
alter table agencies add column if not exists ghl_pipeline_id text;

create unique index if not exists idx_agencies_ghl_contact
  on agencies(ghl_contact_id) where ghl_contact_id is not null;
