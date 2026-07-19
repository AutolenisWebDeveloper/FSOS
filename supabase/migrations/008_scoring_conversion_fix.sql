-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Conversion scorer fix (expired-deadline poisoning)
-- Migration: 008_scoring_conversion_fix
-- Run in: Supabase → SQL Editor → New Query → paste → Run
--
-- score_conversion() took min(conversion_deadline - current_date) over ALL
-- active term policies, including ones whose conversion window had already
-- lapsed. min() returns the MOST NEGATIVE value, so a single expired term
-- policy (e.g. -10 days) poisoned the result for a customer who also had a
-- genuinely urgent live conversion (e.g. +20 days): v_days = -10 → return 0,
-- and the highest-revenue-priority lead silently dropped out of the
-- `conversions` pipeline (which requires conversion_score >= 75).
--
-- Fix: only consider deadlines that have NOT yet lapsed, so min() yields the
-- soonest UPCOMING deadline (highest urgency). Customers whose windows have all
-- closed correctly score 0 (no conversion action remains). Idempotent
-- (create or replace); safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

create or replace function score_conversion(p_customer_id uuid)
returns integer language plpgsql as $$
declare
  v_days integer;
begin
  -- Soonest still-open conversion window. Lapsed windows (deadline < today)
  -- are excluded so they cannot poison the min() for a live urgent policy.
  select min((conversion_deadline - current_date)::integer)
  into v_days
  from policies
  where customer_id = p_customer_id
    and policy_type in ('term', 'term_life')
    and status = 'active'
    and conversion_deadline is not null
    and conversion_deadline >= current_date;

  if v_days is null then return 0; end if;   -- no upcoming (or no) conversions
  if v_days < 0 then return 0; end if;       -- defensive; excluded by WHERE

  if v_days <= 30  then return 100; end if;
  if v_days <= 60  then return 90;  end if;
  if v_days <= 90  then return 75;  end if;
  if v_days <= 180 then return 50;  end if;
  if v_days <= 365 then return 25;  end if;
  return 10;
end;
$$;
