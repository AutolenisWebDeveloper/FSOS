-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 062_fna_recommendations  (FNA Overhaul — Slice 9, build instruction §1)
--
-- The HUMAN recommendation-governance record. FSOS analyzes; the licensed FSA
-- RECOMMENDS. A recommendation is AUTHORED and APPROVED by the FSA — never
-- machine-generated (build instruction §1). This table stores it with the full
-- Reg-BI governance capture (objective, facts, assumptions, methodology,
-- alternatives, advantages/disadvantages, costs, risks, liquidity, limitations,
-- missing info, rationale, reviewer, timestamps) pinned to the FNA version it was
-- based on.
--
-- Additive · idempotent · forward-only. Attaches to the aggregate root at
-- households + the FNA plan/version (ADR-016). Back-office RLS (no client policy).
-- Securities firewall (§4.1): product_category holds a CATEGORY only — never a
-- specific product/carrier, and never securities account detail.
-- (061 is the current head — comms platform; this is 062.)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  create type fna_recommendation_status as enum ('DRAFT','APPROVED','SUPERSEDED','WITHDRAWN');
exception when duplicate_object then null; end $$;

create table if not exists fna_recommendations (
  id                   uuid primary key default gen_random_uuid(),
  plan_id              uuid not null references fna_plans(id) on delete cascade,
  -- The FNA version this recommendation was based on (reproducibility).
  version_id           uuid references fna_versions(id) on delete set null,
  household_id         uuid not null references households(id) on delete cascade,
  status               fna_recommendation_status not null default 'DRAFT',
  -- Reg-BI human-recommendation governance capture (build instruction §1).
  objective            text not null,
  -- CATEGORY only — never a specific product/carrier (§1 red line, §4.1 firewall).
  product_category     text,
  facts_relied_on      text,
  assumptions          text,
  methodology          text,
  alternatives         text,
  advantages           text,
  disadvantages        text,
  costs                text,
  risks                text,
  liquidity            text,
  limitations          text,
  missing_information  text,
  rationale            text,
  authored_by          text,
  approved_by          text,
  approved_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_fna_recommendations_plan on fna_recommendations(plan_id);
create index if not exists idx_fna_recommendations_household on fna_recommendations(household_id);
create index if not exists idx_fna_recommendations_status on fna_recommendations(status);

drop trigger if exists trg_fna_recommendations_updated on fna_recommendations;
create trigger trg_fna_recommendations_updated before update on fna_recommendations
  for each row execute function update_updated_at();

-- RLS — default-deny; back-office/licensed read/write (mirrors the fna_* family,
-- mig 060). No client policy — the RLS proof asserts a client sees zero rows.
alter table fna_recommendations enable row level security;

do $$
declare
  read_roles  text := 'is_super() or has_role(''compliance'') or has_role(''supervisor'') or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'') or has_role(''ops'')';
  write_roles text := 'is_super() or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'')';
begin
  drop policy if exists fna_recommendations_read on fna_recommendations;
  execute format('create policy fna_recommendations_read on fna_recommendations for select using (%s);', read_roles);
  drop policy if exists fna_recommendations_write on fna_recommendations;
  execute format('create policy fna_recommendations_write on fna_recommendations for all using (%s) with check (%s);', write_roles, write_roles);
end $$;
