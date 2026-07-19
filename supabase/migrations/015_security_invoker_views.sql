-- ═══════════════════════════════════════════════════════════════════
-- FSOS — SECURITY FIX: make every reporting view a SECURITY INVOKER view
-- Migration: 015_security_invoker_views
--
-- Supabase's database linter flagged our reporting views as `security_definer`
-- (ERROR-level: security_definer_view). A Postgres view runs by default with the
-- privileges of the view's OWNER, and it does NOT re-apply the underlying tables'
-- Row-Level Security to the caller. That is a hole in the securities firewall
-- (data-guardrails §2.1): the firewall is enforced as an RLS ROW rule on
-- household_policies (a client can never load an is_security row), and a
-- SECURITY DEFINER view over that table would let the same client read the very
-- rows RLS is meant to hide — just by selecting the view instead of the table.
--
-- Postgres 15+ supports `security_invoker = on`, which makes the view execute as
-- the CALLING role, so the underlying tables' RLS applies to view reads exactly
-- as it does to direct table reads. Supabase runs Postgres 15+, so this is safe.
--
-- Server-side app reads are UNAFFECTED: every view is queried through getDb()
-- (the service-role client, which has BYPASSRLS) AFTER an rbac scope assertion,
-- per src/lib/data/query.ts. security_invoker only changes what a NON-service
-- role (anon / authenticated) can see — which is precisely the bypass we are
-- closing. See tests/rls-firewall.test.mjs for the proof on VIEWS.
--
-- Idempotent: `alter view ... set (security_invoker = on)` is re-runnable, and
-- each view is guarded by to_regclass so a partially-migrated DB never errors.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  v text;
  views text[] := array[
    -- 011 (P0 list views)
    'v_agencies_overdue_checkin',
    'v_referrals_awaiting_action',
    -- 012 (P1 pipeline / commission / cross-sell / conversion views)
    'v_pipeline_by_engagement',
    'v_commission_by_agency',
    'v_crosssell_targets',
    'v_cross_sell_gaps',
    'v_conversions_due',
    -- 013 (P2 operational views)
    'v_agency_leaderboard',
    'v_agency_health',
    'v_policy_lapse_risk',
    'v_missing_documents',
    'v_referral_analytics',
    'v_duplicate_households',
    -- 014 (P3 forecasting view) — same class of object; kept consistent so no
    -- security_definer view is left as the pattern (see item 2 of the fix).
    'v_commission_monthly'
  ];
begin
  foreach v in array views loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = on);', v);
    end if;
  end loop;
end $$;
