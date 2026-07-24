-- ─────────────────────────────────────────────────────────
-- Migration: 057_comm_campaign_simulation
--
-- Native Communications Platform — SLICE 6 (§14): simulation mode. A campaign must pass
-- a simulation/preview dry-run before it can be activated (master build instruction §14;
-- ADR-021). This records the last simulation on the campaign so the activate API can
-- enforce "a simulation/preview pass is required before activation".
--
-- Additive, forward-only, idempotent. Nullable columns; existing campaigns are unaffected
-- (they must run a simulation before their next activation). RLS inherited from
-- comm_campaigns (mig 010). No securities data (firewall §4.1). No GHL surface (§0.A).
-- ─────────────────────────────────────────────────────────

alter table comm_campaigns
  add column if not exists simulated_at    timestamptz,
  add column if not exists last_simulation jsonb;

comment on column comm_campaigns.simulated_at is
  'When the campaign last passed a simulation/preview dry-run (§14). The activate API requires a recent value before activation.';
comment on column comm_campaigns.last_simulation is
  'The summary of the last simulation run (audience / would-send / excluded-by-step) for the pre-activation preview (§14).';
