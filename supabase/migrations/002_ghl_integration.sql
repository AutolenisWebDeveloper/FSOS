-- ═══════════════════════════════════════════════════════════════════
-- FSOS — GoHighLevel integration linkage
-- Migration: 002_ghl_integration
-- Run in: Supabase → SQL Editor → New Query → paste → Run
--
-- Adds the ID columns that tie FSOS records back to their GHL counterparts
-- so the /api/webhooks/ghl parser and outbound sync stay idempotent (upsert
-- on the GHL id rather than guessing by email). Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════

-- Customers ↔ GHL contacts
alter table customers        add column if not exists ghl_contact_id text;
-- One "primary" opportunity id kept on the customer for convenience; commission
-- cases carry their own opportunity id (a customer can have several opps).
alter table customers        add column if not exists ghl_opportunity_id text;
alter table customers        add column if not exists ghl_stage_id text;
alter table customers        add column if not exists ghl_pipeline_id text;

-- Commission cases ↔ GHL opportunities
alter table commission_cases add column if not exists ghl_opportunity_id text;

-- Activity ↔ GHL objects (appointment id, message id, etc.)
alter table activity         add column if not exists ghl_activity_id text;

-- Indexes for the webhook's upsert-by-GHL-id lookups. Partial unique on
-- ghl_contact_id keeps one FSOS customer per GHL contact while allowing many
-- NULLs (customers that never touch GHL).
create unique index if not exists idx_customers_ghl_contact
  on customers(ghl_contact_id) where ghl_contact_id is not null;
create index if not exists idx_customers_ghl_opportunity on customers(ghl_opportunity_id);
create index if not exists idx_cases_ghl_opportunity      on commission_cases(ghl_opportunity_id);
create index if not exists idx_activity_ghl               on activity(ghl_activity_id);
