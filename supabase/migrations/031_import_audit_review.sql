-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Import audit trail + manual-review queue + Book-of-Business view
-- Migration: 031_import_audit_review
--
-- Every importer records what it did so there is a complete audit trail of the
-- original imported data, the matching decision (identifiers used + confidence),
-- the fields merged, and the values rejected — and any row that could not be
-- matched with confidence is queued for manual review instead of being guessed.
--
--   import_batches — one row per uploaded file / import run.
--   import_records — one row per imported record: the raw data, the resolution
--                    decision, merged fields, rejected values, and review state.
--
-- Also adds v_book_of_business: one synchronized, read-only row per contact
-- aggregating household, policies, and agency, so the Book of Business and the
-- contact-as-source-of-truth views read a single consistent source.
-- Idempotent; nothing dropped or renamed.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists import_batches (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,                 -- importer: contacts | crosssell | conversion | book
  filename      text,
  actor         text,
  stats         jsonb not null default '{}'::jsonb,
  owner_scope   uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_import_batches_created on import_batches(created_at desc);

create table if not exists import_records (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references import_batches(id) on delete cascade,
  entity_type    text not null default 'contact',            -- contact | policy
  raw            jsonb not null default '{}'::jsonb,          -- the original imported row
  decision       jsonb not null default '{}'::jsonb,          -- {confidence, action, matchedBy[], conflict, candidateIds[]}
  target_id      uuid,                                        -- matched contact/policy (when applicable)
  merged_fields  jsonb not null default '[]'::jsonb,          -- fields filled from the import
  rejected_values jsonb not null default '[]'::jsonb,         -- incoming values NOT written (existing kept)
  confidence     text not null default 'none',                -- exact | high | medium | low | none
  review_status  text not null default 'auto'
                   check (review_status in ('auto','needs_review','resolved','skipped')),
  resolved_by    text,
  resolved_at    timestamptz,
  owner_scope    uuid,
  created_at     timestamptz not null default now()
);
create index if not exists idx_import_records_batch  on import_records(batch_id);
create index if not exists idx_import_records_review on import_records(review_status) where review_status = 'needs_review';
create index if not exists idx_import_records_target on import_records(target_id);

-- ── Book of Business — one synchronized row per contact ──────────────────────
create or replace view v_book_of_business
with (security_invoker = true) as
select
  c.id                                   as contact_id,
  c.full_name,
  c.contact_type,
  c.email,
  c.phone,
  c.household_id,
  h.primary_name                         as household_name,
  c.agency_partnership_id,
  ap.agency_name,
  ap.fnwl_serving_agent_no               as agent_number,
  coalesce(pol.policy_count, 0)          as policy_count,
  coalesce(pol.total_face, 0)            as total_face_amount,
  pol.next_conversion_deadline,
  c.lines_of_business,
  c.tags,
  c.status
from contacts c
left join households h            on h.id = c.household_id and h.deleted_at is null
left join agency_partnerships ap  on ap.id = c.agency_partnership_id and ap.deleted_at is null
left join lateral (
  select count(*)                    as policy_count,
         sum(hp.face_amount)         as total_face,
         min(hp.conversion_deadline) filter (where hp.conversion_deadline is not null) as next_conversion_deadline
  from household_policies hp
  where hp.deleted_at is null
    and (hp.contact_id = c.id or (c.household_id is not null and hp.household_id = c.household_id))
) pol on true
where c.deleted_at is null;

-- ── RLS — default-deny; read for staff/compliance/super; writes via service role.
alter table import_batches enable row level security;
alter table import_records enable row level security;

drop policy if exists import_batches_read on import_batches;
create policy import_batches_read on import_batches for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
drop policy if exists import_records_read on import_records;
create policy import_records_read on import_records for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
