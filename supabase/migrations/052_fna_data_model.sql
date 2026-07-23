-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 052_fna_data_model  (FNA Overhaul — Slice 2, ADR-016)
--
-- The FNA had NO structured data model — only reviews / review_types existed, and
-- generated analyses were AI prose saved as a document. This slice adds the
-- additive `fna_*` family that captures inputs, freezes IMMUTABLE versions, stores
-- the exact assumption-set + engine version used, records per-formula results, and
-- supports scenarios, goals, and data-quality exceptions — all attached to the
-- aggregate root at households (ADR-001) and reusing reviews where one applies.
--
-- (050 is the current migration head; the build instruction's "start at 049" is
--  stale because the comms slice already added 049/050, and the agency-directory
--  import (merged from main) took 051. This is 052.)
--
-- Additive · idempotent · forward-only. Reuses is_super()/has_role() (mig 010),
-- update_updated_at() (mig 012), and the append-only audit_log via app-level
-- writeAudit — no new audit table (CLAUDE.md §6). Guardrails: the securities
-- firewall (§4.1) is preserved (no securities account/holdings columns; balances
-- are aggregate numerics only); assumptions stay is_assumption-flagged (§4.3).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enums (idempotent) ───────────────────────────────────────────────────────
do $$ begin
  create type fna_status as enum (
    'DRAFT','IN_PROGRESS','CALCULATED','UNDER_REVIEW','APPROVED','SUPERSEDED','ARCHIVED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type fna_value_label as enum (
    'verified','client_supplied','imported','calculated','estimated',
    'assumption_based','incomplete','unavailable','needs_confirmation'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type fna_dq_kind as enum ('missing','stale','conflicting','unverified');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fna_dq_severity as enum ('error','warning','info');
exception when duplicate_object then null; end $$;

-- ── 1. fna_plans — the FNA record ────────────────────────────────────────────
create table if not exists fna_plans (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references households(id) on delete cascade,
  -- Reuse the review spine: a plan may attach to a review that triggered it.
  review_id          uuid references reviews(id) on delete set null,
  -- Plan-type registry KEY (validated in app, not the DB, so new types need no
  -- migration): express | comprehensive | financial_plan | annual_review | ...
  plan_type          text not null,
  status             fna_status not null default 'DRAFT',
  title              text,
  -- Pointer to the latest/active immutable version (set after a version is frozen).
  current_version_id uuid,
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists idx_fna_plans_household on fna_plans(household_id) where deleted_at is null;
create index if not exists idx_fna_plans_status    on fna_plans(status)       where deleted_at is null;
create index if not exists idx_fna_plans_review    on fna_plans(review_id)     where review_id is not null;
create index if not exists idx_fna_plans_type      on fna_plans(plan_type);

-- ── 2. fna_versions — IMMUTABLE snapshot (inputs + assumptions + results) ─────
create table if not exists fna_versions (
  id                       uuid primary key default gen_random_uuid(),
  plan_id                  uuid not null references fna_plans(id) on delete cascade,
  version_no               integer not null,
  status                   fna_status not null default 'CALCULATED',
  -- Frozen copy of the assumption-set used, and its pinned version — so any result
  -- is recomputable identically (ADR-015).
  assumption_set           jsonb not null default '{}'::jsonb,
  assumption_set_version   text not null,
  engine_version           text not null,
  -- Frozen inputs + rolled-up results at calc time.
  inputs_snapshot          jsonb not null default '{}'::jsonb,
  results                  jsonb not null default '{}'::jsonb,
  -- Optional AI narrative (the existing FnaReport shape) — analysis, never a rec.
  narrative                jsonb,
  approved_by              text,
  approved_at              timestamptz,
  superseded_by_version_id uuid references fna_versions(id) on delete set null,
  created_by               text,
  created_at               timestamptz not null default now(),
  unique (plan_id, version_no)
);
create index if not exists idx_fna_versions_plan on fna_versions(plan_id, version_no desc);

-- fna_plans.current_version_id → fna_versions (added after the table exists).
do $$ begin
  alter table fna_plans
    add constraint fna_plans_current_version_fk
    foreign key (current_version_id) references fna_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Immutability: a frozen version's SNAPSHOT columns may never change, and an
-- APPROVED version may never be deleted (build instruction §9). Lifecycle columns
-- (status, approval stamp, supersede pointer) remain editable.
create or replace function fna_versions_guard_immutable() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'APPROVED' then
      raise exception 'fna_versions: an APPROVED version is immutable and cannot be deleted (id=%)', old.id;
    end if;
    return old;
  end if;
  -- UPDATE: forbid changes to any content/snapshot column.
  if new.plan_id                is distinct from old.plan_id
     or new.version_no          is distinct from old.version_no
     or new.assumption_set      is distinct from old.assumption_set
     or new.assumption_set_version is distinct from old.assumption_set_version
     or new.engine_version      is distinct from old.engine_version
     or new.inputs_snapshot     is distinct from old.inputs_snapshot
     or new.results             is distinct from old.results
     or new.narrative           is distinct from old.narrative
     or new.created_at          is distinct from old.created_at
     or new.created_by          is distinct from old.created_by then
    raise exception 'fna_versions: snapshot columns are immutable (id=%); only status/approval/supersede may change', old.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_fna_versions_immutable on fna_versions;
create trigger trg_fna_versions_immutable
  before update or delete on fna_versions
  for each row execute function fna_versions_guard_immutable();

-- ── 3. fna_inputs — live working set (no uniqueness → conflicts detectable) ───
create table if not exists fna_inputs (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid not null references fna_plans(id) on delete cascade,
  member_id           uuid references household_members(id) on delete set null,
  section             text not null,   -- income | expenses | assets | liabilities | coverage | goals | dependents | employment | benefits | household
  key                 text not null,   -- e.g. monthly_income
  value_numeric       numeric,         -- money/rate (aggregate balances only — §4.1)
  value_text          text,
  unit                text,
  source_label        fna_value_label not null default 'client_supplied',
  source_record       text,            -- pointer to origin, e.g. household_policies:<id>
  entered_by          text,
  verification_status text not null default 'unverified'
                        check (verification_status in ('unverified','verified','disputed')),
  effective_date      date,
  freshness_at        timestamptz,
  confidence          text check (confidence in ('high','medium','low')),
  client_confirmed    boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_fna_inputs_plan        on fna_inputs(plan_id);
create index if not exists idx_fna_inputs_plan_key    on fna_inputs(plan_id, section, key);
create index if not exists idx_fna_inputs_member      on fna_inputs(member_id) where member_id is not null;

-- ── 4. fna_assumption_sets — versioned, editable store (seeded from engine) ───
create table if not exists fna_assumption_sets (
  id            uuid primary key default gen_random_uuid(),
  version       text not null unique,   -- default-v1, or a household-custom version
  label         text not null,
  scope         text not null default 'global' check (scope in ('global','household')),
  household_id  uuid references households(id) on delete cascade,
  assumptions   jsonb not null default '[]'::jsonb,  -- [{key,value,unit,source,effective_date,is_assumption}]
  is_active     boolean not null default true,
  created_by    text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A household-scoped set must name its household; a global set must not.
  check ((scope = 'household' and household_id is not null) or (scope = 'global' and household_id is null))
);
create index if not exists idx_fna_assumption_sets_household on fna_assumption_sets(household_id) where household_id is not null;

-- Seed the engine's DEFAULT_ASSUMPTIONS as the global default-v1 set (labeled
-- is_assumption — config defaults to verify, NOT Farmers/FFS facts, §4.3).
insert into fna_assumption_sets (version, label, scope, assumptions, created_by)
values (
  'default-v1',
  'FSOS planning defaults (config — verify before relying on them)',
  'global',
  '[
    {"key":"inflation_rate","value":0.03,"unit":"rate","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"wage_growth_rate","value":0.03,"unit":"rate","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"investment_return_pre_retirement","value":0.06,"unit":"rate","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"investment_return_post_retirement","value":0.04,"unit":"rate","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"retirement_age","value":67,"unit":"years","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"life_expectancy","value":92,"unit":"years","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"education_inflation_rate","value":0.05,"unit":"rate","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"social_security_cola","value":0.02,"unit":"rate","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"effective_tax_rate","value":0.22,"unit":"rate","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"safe_withdrawal_rate","value":0.04,"unit":"rate","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"emergency_fund_months","value":6,"unit":"months","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"disability_replacement_pct","value":60,"unit":"pct","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"income_replacement_years","value":10,"unit":"years","source":"config default","effective_date":"2026-01-01","is_assumption":true},
    {"key":"final_expenses","value":15000,"unit":"usd","source":"config default","effective_date":"2026-01-01","is_assumption":true}
  ]'::jsonb,
  'system'
)
on conflict (version) do nothing;

-- ── 5. fna_goals — first-class goals (analyses attach here) ───────────────────
create table if not exists fna_goals (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  plan_id        uuid references fna_plans(id) on delete cascade,
  member_id      uuid references household_members(id) on delete set null,
  goal_type      text not null,   -- retirement | education | emergency_fund | mortgage_payoff | income_replacement | legacy | business_exit | special_needs | charitable | custom
  label          text not null,
  priority       integer not null default 0,
  target_amount  numeric,
  target_date    date,
  current_funding numeric not null default 0,
  funding_status text check (funding_status in ('on_track','at_risk','off_track','unfunded','funded')),
  confidence     text check (confidence in ('high','medium','low')),
  progress       numeric,         -- 0..1
  created_by     text,
  updated_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists idx_fna_goals_household on fna_goals(household_id) where deleted_at is null;
create index if not exists idx_fna_goals_plan      on fna_goals(plan_id)      where plan_id is not null;

-- ── 6. fna_results — per-formula CalcResult envelopes for a version (immutable) ─
create table if not exists fna_results (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references fna_versions(id) on delete cascade,
  plan_id         uuid not null references fna_plans(id) on delete cascade,
  goal_id         uuid references fna_goals(id) on delete set null,
  formula_id      text not null,
  formula_version text not null,
  envelope        jsonb not null,   -- the full CalcResult (ADR-015)
  confidence      text check (confidence in ('high','medium','low')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_fna_results_version on fna_results(version_id);
create index if not exists idx_fna_results_plan    on fna_results(plan_id);
create index if not exists idx_fna_results_formula on fna_results(formula_id);

-- ── 7. fna_scenarios — named what-ifs branched from a frozen version ──────────
create table if not exists fna_scenarios (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references fna_plans(id) on delete cascade,
  base_version_id uuid not null references fna_versions(id) on delete cascade,
  name            text not null,
  scenario_type   text not null,   -- retirement_age | increased_savings | reduced_expenses | ... | custom
  overrides       jsonb not null default '{}'::jsonb,
  results         jsonb not null default '{}'::jsonb,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_fna_scenarios_plan on fna_scenarios(plan_id);
create index if not exists idx_fna_scenarios_base on fna_scenarios(base_version_id);

-- ── 8. fna_data_quality_exceptions — missing/stale/conflicting/unverified ─────
create table if not exists fna_data_quality_exceptions (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references fna_plans(id) on delete cascade,
  input_id   uuid references fna_inputs(id) on delete cascade,
  kind       fna_dq_kind not null,
  severity   fna_dq_severity not null default 'warning',
  section    text,
  key        text,
  detail     text,
  resolved   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fna_dq_plan on fna_data_quality_exceptions(plan_id) where resolved = false;

-- ── 9. updated_at triggers (shared update_updated_at(), defined in mig 001) ───
-- Defined defensively here (identical body, create-or-replace) so this migration
-- is self-contained — the RLS proof harness applies a minimal migration subset
-- that does not include 001.
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'fna_plans','fna_inputs','fna_assumption_sets','fna_goals','fna_scenarios','fna_data_quality_exceptions'
  ]
  loop
    execute format('drop trigger if exists %I on %I;', 'trg_'||t||'_updated', t);
    execute format('create trigger %I before update on %I for each row execute function update_updated_at();', 'trg_'||t||'_updated', t);
  end loop;
end $$;
-- Note: fna_versions and fna_results are immutable — no updated_at trigger.

-- ── 10. RLS — default-deny; back-office/licensed staff read/write ─────────────
-- Mirrors the compliance module (mig 036) and household-adjacent internal tooling.
-- No client policy in this slice (RLS proof asserts a client sees zero fna_* rows);
-- reads go through is_super()/has_role() so a household-scoped client read policy
-- can be added later without reshaping the model.
do $$
declare t text;
begin
  foreach t in array array[
    'fna_plans','fna_versions','fna_inputs','fna_assumption_sets','fna_goals',
    'fna_results','fna_scenarios','fna_data_quality_exceptions'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

do $$
declare
  t text;
  read_roles  text := 'is_super() or has_role(''compliance'') or has_role(''supervisor'') or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'') or has_role(''ops'')';
  write_roles text := 'is_super() or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'')';
begin
  foreach t in array array[
    'fna_plans','fna_versions','fna_inputs','fna_assumption_sets','fna_goals',
    'fna_results','fna_scenarios','fna_data_quality_exceptions'
  ]
  loop
    execute format('drop policy if exists %I on %I;', t || '_read', t);
    execute format('create policy %I on %I for select using (%s);', t || '_read', t, read_roles);
    execute format('drop policy if exists %I on %I;', t || '_write', t);
    execute format('create policy %I on %I for all using (%s) with check (%s);', t || '_write', t, write_roles, write_roles);
  end loop;
end $$;
