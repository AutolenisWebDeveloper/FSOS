-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Contact Import: Field Recognition & Mapping Model (design spec v2.1)
-- Migration: 096_contact_import_mapping_model
--
-- The persistence layer for the unified contact-import mapper: it learns a file's
-- column mapping ONCE and re-applies it automatically on the next file of the same
-- shape (spec §5). Three additive registry tables + two additive columns on
-- contacts. Nothing dropped or renamed; fully idempotent.
--
--   import_templates      — one row per recognized file signature: the detected
--                           district template (if any) and the confirmed
--                           source-header → decision map. Auto-loads on the next
--                           file whose header signature matches.
--   import_header_memory  — global per-header memory: every manual decision
--                           (e.g. "Policy Owner → owner", "AOR with Series Code →
--                           split") remembered across ALL files.
--   custom_fields         — operator-defined fields (entity/key/label/type) that
--                           appear in the mapping dropdown next time. No schema
--                           migration per field — values land in the entity's
--                           `custom` jsonb.
--
--   contacts.custom (jsonb)  — per-contact custom-field + as-is import values.
--   contacts.dob   (date)    — plain DOB (spec: imports as a normal field, NO
--                              gating, NO encryption — consistent with the
--                              owner's plain customers.dob decision, mig 044).
--
-- Security: RLS default-deny; internal-role reads only; writes via the service
-- role AFTER an rbac assertion (service role bypasses RLS). `grant select … to
-- authenticated` so a stray JWT read denies BY ROW rather than erroring. These
-- hold no client PII beyond the contacts.dob/custom columns, which inherit the
-- contacts table's existing protections.
-- ═══════════════════════════════════════════════════════════════════

-- ── import_templates ───────────────────────────────────────────────────────
create table if not exists import_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  source_signature text not null,                       -- signatureHash(headers) — stable, order-independent
  template_key     text,                                -- detected district template key, when known (spec §1)
  header_map       jsonb not null default '{}'::jsonb,  -- squashed source header → decision {kind, …}
  usage_count      integer not null default 0,
  last_used_at     timestamptz,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists uq_import_templates_signature on import_templates(source_signature);
create index if not exists idx_import_templates_last_used on import_templates(last_used_at desc nulls last);

drop trigger if exists import_templates_updated_at on import_templates;
create trigger import_templates_updated_at before update on import_templates
  for each row execute function update_updated_at();

-- ── import_header_memory ───────────────────────────────────────────────────
-- One row per distinct squashed source header ever decided. Global — applies
-- across every file even when no full-template match exists (spec §5).
create table if not exists import_header_memory (
  squashed_header  text primary key,                    -- squashHeader(source) — the memory key
  sample_header    text,                                -- a human-readable example of the raw header
  decision         jsonb not null,                      -- {kind, …} — same shape as header_map values
  usage_count      integer not null default 1,
  last_used_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists import_header_memory_updated_at on import_header_memory;
create trigger import_header_memory_updated_at before update on import_header_memory
  for each row execute function update_updated_at();

-- ── custom_fields ──────────────────────────────────────────────────────────
-- Operator-defined fields attached to an import entity. No per-field schema
-- change — values are stored in the entity's `custom` jsonb (contacts.custom for
-- the Contact Center). Appears in the mapping dropdown on the next import.
create table if not exists custom_fields (
  id           uuid primary key default gen_random_uuid(),
  entity       text not null check (entity in ('household','member','policy','agency')),
  key          text not null,                            -- snake_case storage key within `custom`
  label        text not null,
  field_type   text not null default 'text'
                 check (field_type in ('text','number','date','phone','email','tag')),
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_custom_fields_entity_key on custom_fields(entity, key);

drop trigger if exists custom_fields_updated_at on custom_fields;
create trigger custom_fields_updated_at before update on custom_fields
  for each row execute function update_updated_at();

-- ── contacts: additive custom-value + plain DOB columns ────────────────────
alter table contacts add column if not exists custom jsonb not null default '{}'::jsonb;
alter table contacts add column if not exists dob date;   -- plain; no gating, no encryption (§ spec / mig 044)

-- ── RLS: deny-by-default; internal-role reads only; revoke anon/authenticated writes ──
do $$
declare t text;
begin
  foreach t in array array['import_templates','import_header_memory','custom_fields'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);  -- deny BY ROW, not error
  end loop;
end $$;

drop policy if exists import_templates_read on import_templates;
create policy import_templates_read on import_templates for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

drop policy if exists import_header_memory_read on import_header_memory;
create policy import_header_memory_read on import_header_memory for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);

drop policy if exists custom_fields_read on custom_fields;
create policy custom_fields_read on custom_fields for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff') or has_role('admin')
);
