-- 036_compliance_intelligence.sql
-- (Renumbered from 035 to resolve a version collision: main independently added
--  035_comm_hours.sql. Supabase keys migrations by the numeric prefix, so two 035
--  files caused a duplicate schema_migrations version. This migration is fully
--  idempotent, so re-applying it under version 036 is safe.)
-- Compliance Intelligence module (owner-authorized 2026-07-19; see CLAUDE.md §3
-- authorized-exception note + §2.1 firewall constraints, and docs/compliance/).
--
-- A retrieval-grounded drafting/analysis aid that helps the FSA resolve NIGOs,
-- prepare RightBridge/paperwork, and strengthen case notes — grounded in an
-- authority-tagged knowledge library the FSA owns and grows. This is an ISOLATED
-- subsystem: its own tables, no FK into the aggregate-root case spine.
--
-- Retrieval note: the working retrieval path is Postgres full-text search over a
-- weighted `search_tsv` (same proven mechanism as knowledge_documents, mig 033).
-- A nullable pgvector `embedding` column is added when the extension is available,
-- for optional future semantic back-fill — the system is fully functional on FTS
-- alone with only the Anthropic key present (no invented embeddings dependency).
--
-- NOTE: table names are prefixed `compliance_` to avoid colliding with the
-- existing `knowledge_documents` table (the AI Knowledge Library, mig 033).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Optional pgvector extension (never blocks the FTS-based install)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  create extension if not exists vector;
exception when others then
  raise notice 'pgvector unavailable; compliance_chunks.embedding skipped (FTS retrieval still works).';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type authority_type as enum (
    'FINRA_RULE', 'SEC_RULE', 'STATE_REQUIREMENT', 'CARRIER_REQUIREMENT',
    'FORM_INSTRUCTION', 'FFS_PROCEDURE', 'SUITABILITY_STANDARD', 'INTERNAL_PREFERENCE'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type nigo_validity as enum (
    'valid', 'partially_valid', 'duplicative', 'inconsistent',
    'unsupported', 'needs_clarification'
  );
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Knowledge library — documents + chunks (the grounding corpus)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists compliance_documents (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  authority_type authority_type not null,
  source_org     text,                         -- FINRA, SEC, TX, FFS, Pacific Life, ...
  section_ref    text,                          -- doc-level primary citation, optional
  effective_date date,
  product_scope  text[] not null default '{}',  -- VA, VUL, MF, 529, ...  (ALL = wildcard)
  state_scope    text[] not null default '{}',  -- TX, ...                (ALL = wildcard)
  carrier        text,
  -- verbatim=false ⇒ paraphrased-for-index with a correct section_ref; verify the
  -- primary-source text and flip true before a chunk grounds an EXTERNAL response.
  verbatim       boolean not null default false,
  -- Farmers/FFS-specific config defaults stay assumption-flagged (Guardrail 3).
  is_assumption  boolean not null default false,
  source         text not null default 'upload' -- upload | manual | import | seed
                   check (source in ('upload','manual','import','seed')),
  file_ref       text,                          -- storage path / external ref
  notes          text,
  created_by     text,
  updated_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_compliance_documents_authority on compliance_documents(authority_type);
create index if not exists idx_compliance_documents_carrier   on compliance_documents(carrier);
create index if not exists idx_compliance_documents_product   on compliance_documents using gin(product_scope);
create index if not exists idx_compliance_documents_state     on compliance_documents using gin(state_scope);

create table if not exists compliance_chunks (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references compliance_documents(id) on delete cascade,
  -- Stable external id from the corpus (e.g. "FINRA-2330-b1A") so the loader is
  -- idempotent (upsert by chunk_key). NULL for chunks produced by the chunker.
  chunk_key       text unique,
  seq             integer not null default 0,
  -- authority_type is inherited from the parent doc at write time (drives the
  -- tier hierarchy in retrieval without a join).
  authority_type  authority_type not null,
  section_ref     text,                          -- e.g. "2330(b)(1)(A)" — precise citation
  title           text,
  chunk_text      text not null,
  product_scope   text[] not null default '{}',
  state_scope     text[] not null default '{}',
  governs_patterns text[] not null default '{}', -- NIGO patterns this chunk governs
  verbatim        boolean not null default false,
  -- Weighted FTS vector (primary retrieval path) — maintained by trigger below.
  search_tsv      tsvector,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_compliance_chunks_document  on compliance_chunks(document_id);
create index if not exists idx_compliance_chunks_authority on compliance_chunks(authority_type);
create index if not exists idx_compliance_chunks_product   on compliance_chunks using gin(product_scope);
create index if not exists idx_compliance_chunks_tsv       on compliance_chunks using gin(search_tsv);

-- Optional embedding column + ANN index, only when pgvector is present.
do $$
begin
  if exists (select 1 from pg_type where typname = 'vector') then
    alter table compliance_chunks add column if not exists embedding vector(1536);
    -- ivfflat cosine index for future semantic retrieval; harmless while NULL.
    begin
      create index if not exists idx_compliance_chunks_embedding
        on compliance_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
    exception when others then
      raise notice 'ivfflat index skipped (%).', SQLERRM;
    end;
  end if;
end $$;

-- Weighted search vector: citation + title carry most weight, then body, then patterns.
create or replace function compliance_chunks_tsv_update() returns trigger as $$
begin
  new.search_tsv :=
    setweight(to_tsvector('english', coalesce(new.section_ref,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.chunk_text,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(new.governs_patterns,' '),'')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(new.product_scope,' '),'')), 'C');
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_compliance_chunks_tsv on compliance_chunks;
create trigger trg_compliance_chunks_tsv
  before insert or update of section_ref, title, chunk_text, governs_patterns, product_scope
  on compliance_chunks
  for each row execute function compliance_chunks_tsv_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. NIGO case history (the memory) — self-contained, NOT linked to the case spine
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists nigo_cases (
  id             uuid primary key default gen_random_uuid(),
  work_item      text,                          -- free-text work/reference id (NOT a FK)
  client_ref     text,                          -- non-substantive reference only
  product        text,
  carrier        text,
  reviewer       text,
  state          text,
  raw_nigo_text  text not null,
  received_at    timestamptz not null default now(),
  round_number   integer not null default 1,
  outcome        text not null default 'open'
                   check (outcome in ('open','resolved','rejected','escalated','withdrawn')),
  lessons_learned text,
  resolved_at    timestamptz,
  created_by     text,
  updated_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_nigo_cases_outcome on nigo_cases(outcome);
create index if not exists idx_nigo_cases_product on nigo_cases(product);
create index if not exists idx_nigo_cases_carrier on nigo_cases(carrier);
create index if not exists idx_nigo_cases_received on nigo_cases(received_at desc);

create table if not exists nigo_issues (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references nigo_cases(id) on delete cascade,
  seq              integer not null default 0,
  issue_text       text not null,
  matched_chunk_ids uuid[] not null default '{}', -- compliance_chunks.id (soft ref)
  citations        text[] not null default '{}',  -- section_refs actually used
  authority_type   authority_type,                -- NULL ⇒ unsupported by the library
  validity         nigo_validity,
  explanation      text,
  whats_wrong      text,
  what_to_fix      text,
  draft_artifact   text,
  resolution       text,
  response_text    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_nigo_issues_case     on nigo_issues(case_id);
create index if not exists idx_nigo_issues_validity on nigo_issues(validity);
create index if not exists idx_nigo_issues_authority on nigo_issues(authority_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RightBridge reports (learned structure + per-case parsed values)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists rightbridge_reports (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid references nigo_cases(id) on delete set null,
  report_type      text not null default 'product_profiler'
                     check (report_type in ('product_profiler','life_wizard','other')),
  title            text,
  parsed_fields    jsonb not null default '{}'::jsonb,   -- every field + value extracted
  scoring_flags    jsonb not null default '{}'::jsonb,   -- green/yellow/red per axis
  consistency_flags jsonb not null default '[]'::jsonb,  -- [{field, issue, citation}]
  raw_text         text,
  source           text not null default 'upload'
                     check (source in ('upload','manual','import')),
  file_ref         text,
  uploaded_at      timestamptz not null default now(),
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_rightbridge_case on rightbridge_reports(case_id);
create index if not exists idx_rightbridge_type on rightbridge_reports(report_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. updated_at triggers (reuse the shared update_updated_at() function, mig 012)
-- ─────────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_compliance_documents_updated on compliance_documents;
create trigger trg_compliance_documents_updated before update on compliance_documents
  for each row execute function update_updated_at();

drop trigger if exists trg_compliance_chunks_updated on compliance_chunks;
create trigger trg_compliance_chunks_updated before update on compliance_chunks
  for each row execute function update_updated_at();

drop trigger if exists trg_nigo_cases_updated on nigo_cases;
create trigger trg_nigo_cases_updated before update on nigo_cases
  for each row execute function update_updated_at();

drop trigger if exists trg_nigo_issues_updated on nigo_issues;
create trigger trg_nigo_issues_updated before update on nigo_issues
  for each row execute function update_updated_at();

drop trigger if exists trg_rightbridge_updated on rightbridge_reports;
create trigger trg_rightbridge_updated before update on rightbridge_reports
  for each row execute function update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS — default-deny; internal licensed/compliance staff read/write. Writes run
--    under the service role (getDb) AFTER lib/auth/api gating, same pattern as
--    010/012/013/033. Helpers is_super()/has_role() are defined in migration 010.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'compliance_documents','compliance_chunks','nigo_cases','nigo_issues','rightbridge_reports'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- Read: any internal staff role that touches compliance work.
-- Write: licensed producer + supervisory/compliance + admin/super (this is the
--        FSA's own drafting workspace; not client- or partner-facing).
do $$
declare
  t text;
  read_roles  text := 'is_super() or has_role(''compliance'') or has_role(''supervisor'') or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'') or has_role(''ops'')';
  write_roles text := 'is_super() or has_role(''compliance'') or has_role(''supervisor'') or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'')';
begin
  foreach t in array array[
    'compliance_documents','compliance_chunks','nigo_cases','nigo_issues','rightbridge_reports'
  ]
  loop
    execute format('drop policy if exists %I on %I;', t || '_read', t);
    execute format('create policy %I on %I for select using (%s);', t || '_read', t, read_roles);
    execute format('drop policy if exists %I on %I;', t || '_write', t);
    execute format('create policy %I on %I for all using (%s) with check (%s);', t || '_write', t, write_roles, write_roles);
  end loop;
end $$;
