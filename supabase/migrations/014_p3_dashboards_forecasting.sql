-- ═══════════════════════════════════════════════════════════════════
-- FSOS — P3 (advanced future) support
-- Migration: 014_p3_dashboards_forecasting
--
-- Adds the two P3 (Phase 4) features from docs/build-order.md:
--   • Custom dashboard builder — a `dashboards` table holding a saved layout of
--     widgets. Every widget renders from a real, DB-derived metric (no drift);
--     the layout only pins WHICH metrics, in WHAT order, and the dashboard name.
--   • Advanced forecasting — `forecast_settings` holds the stage close-probability
--     assumptions (is_assumption=true, editable config defaults per guardrail §2.3)
--     and a horizon. `v_commission_monthly` gives the historical run-rate the
--     forecast projects forward.
--
-- Nothing here weakens a P0/P1/P2 guardrail:
--   • is_security is carried through the forecasting source data so securities
--     production can be shown SEPARATELY and never mixed into an automated send —
--     these surfaces are internal production tracking only (firewall §2.1 permits
--     tracking stage + expected/actual commission for the FSA's own production).
--   • forecast assumptions are flagged is_assumption and render the
--     "config default — verify" badge; none are invented Farmers figures (§2.3).
--   • dashboards are internal read surfaces — no client-facing send path touches them.
-- Idempotent: safe to re-run. Nothing here drops or renames a legacy object.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- 1. Custom dashboards (OS-01 dashboard builder)
--    layout = ordered array of widget keys, e.g. ["open_opportunities","commission_ytd"].
--    Each key resolves to a DB-derived metric in lib/analytics/metrics.ts (no drift).
-- ─────────────────────────────────────────────────────────
create table if not exists dashboards (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  layout       jsonb not null default '[]',          -- ["widget_key", ...] in display order
  visibility   text not null default 'private'
                 check (visibility in ('private','shared')),
  created_by   text,
  updated_by   text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_dashboards_active on dashboards(created_at desc) where archived_at is null;

-- ─────────────────────────────────────────────────────────
-- 2. Forecast settings — stage close-probability ASSUMPTIONS + horizon.
--    A single active row of editable config defaults. Stage → probability is a
--    modeling assumption, NOT a Farmers-published figure, so is_assumption=true
--    and the UI renders the "config default — verify" badge (guardrail §2.3).
-- ─────────────────────────────────────────────────────────
create table if not exists forecast_settings (
  id             uuid primary key default gen_random_uuid(),
  probabilities  jsonb not null default '{}',         -- {stage: 0..1}
  horizon_months integer not null default 3 check (horizon_months between 1 and 24),
  is_assumption  boolean not null default true,       -- CONFIG DEFAULT — verify
  updated_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Seed one row of conservative, clearly-labeled defaults (only if none exists).
insert into forecast_settings (probabilities, horizon_months, is_assumption)
select '{"prospect":0.10,"fact_find":0.25,"quoted_proposed":0.45,"application":0.70,"underwriting_suitability":0.85}'::jsonb, 3, true
where not exists (select 1 from forecast_settings);

-- ─────────────────────────────────────────────────────────
-- 3. v_commission_monthly — historical FSA commission by month (the run-rate the
--    forecast projects forward). Only reconciled money counts (received|matched);
--    is_security is carried so securities production can be split out.
--    security_invoker=on so the caller's RLS applies to view reads (see 015).
-- ─────────────────────────────────────────────────────────
create or replace view v_commission_monthly
  with (security_invoker = on) as
select
  to_char(date_trunc('month', coalesce(c.paid_on, c.created_at::date)), 'YYYY-MM') as month,
  c.is_security,
  count(*)                                   as commission_count,
  coalesce(sum(c.total_commission), 0)       as total_commission,
  coalesce(sum(c.fsa_amount), 0)             as fsa_amount
from commissions c
where c.reconciliation_status in ('received', 'matched')
group by 1, 2;

-- ─────────────────────────────────────────────────────────
-- 4. RLS — internal staff read/write; is_super() always allowed.
-- ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['dashboards','forecast_settings']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I_rw on %I;', t, t);
    execute format($p$create policy %I_rw on %I for all using (
      is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
    ) with check (
      is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
    );$p$, t, t);
  end loop;
end $$;
