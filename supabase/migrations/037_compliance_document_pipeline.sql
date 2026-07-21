-- 037_compliance_document_pipeline.sql
-- Compliance Intelligence — server-side document ingestion & processing pipeline
-- (extends the owner-authorized module from migration 036; see CLAUDE.md §5
--  authorized exception (docs/adr/ADR-012) + §4.1 firewall constraints, and docs/compliance/).
--
-- WHY: until now the module could only accept ALREADY-EXTRACTED text pasted into a
-- textarea. There was no way to upload a complete RightBridge PDF (or a NIGO notice,
-- form, disclosure, statement, illustration) and have the system secure it, extract
-- its text page-by-page, index it, structure it, and drive the analysis engine off
-- it. This migration adds the durable records that pipeline needs.
--
-- ISOLATION (unchanged design rule from 036): still an isolated subsystem — its own
-- `compliance_*` / `nigo_*` / `rightbridge_*` tables, NO FK into the aggregate-root
-- case spine. Uploads reference `nigo_cases`, never `cases`. Original files live in
-- the existing private `documents` storage bucket (mig 001) under a `compliance/`
-- prefix, reached only via short-lived signed URLs — never a public URL.
--
-- Idempotent throughout (create ... if not exists / add column if not exists / the
-- do-block enum + policy loops), matching the 036 conventions. Apply after 036.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enum: the document-processing lifecycle (the visible stages)
-- ─────────────────────────────────────────────────────────────────────────────
--   uploaded    → multipart received, not yet persisted to storage
--   secured     → stored in the private bucket, metadata row written
--   extracting  → text/OCR extraction in progress
--   extracted   → per-page text captured (compliance_upload_pages populated)
--   structuring → building the structured representation (RightBridge fields, etc.)
--   analyzed    → structured representation / downstream record produced
--   needs_review→ low-confidence extraction; a human must inspect before trusting
--   failed      → a stage errored; `error` holds the reason, retry is available
do $$ begin
  create type compliance_upload_status as enum (
    'uploaded','secured','extracting','extracted','structuring','analyzed','needs_review','failed'
  );
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. compliance_uploads — one row per uploaded file + its processing record
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists compliance_uploads (
  id                uuid primary key default gen_random_uuid(),
  -- Optional link to the NIGO case this file belongs to (self-contained module;
  -- NULL for library/pre-submission uploads not yet tied to a case).
  case_id           uuid references nigo_cases(id) on delete set null,
  -- What kind of document this is (drives classification + which workspace uses it).
  kind              text not null default 'other'
                      check (kind in (
                        'rightbridge','nigo','form','disclosure','statement',
                        'illustration','contract','supporting','other'
                      )),
  filename          text not null,
  storage_path      text not null,                 -- path in the private `documents` bucket
  content_type      text,
  size_bytes        bigint,
  -- SHA-256 of the file bytes → duplicate detection (warn/link, never silently dupe).
  sha256            text,
  status            compliance_upload_status not null default 'uploaded',
  -- native_pdf = positioned-glyph text extraction; claude_pdf = model vision read
  -- (the OCR fallback for scanned/low-text PDFs); text = plain-text file; image =
  -- model vision on an image; none = not yet / unsupported.
  extraction_method text not null default 'none'
                      check (extraction_method in ('native_pdf','claude_pdf','text','image','none')),
  page_count        integer not null default 0,
  char_count        integer not null default 0,
  -- 0..1 heuristic/OCR confidence; low_confidence gates the needs_review status.
  extraction_confidence numeric(4,3),
  low_confidence    boolean not null default false,
  error             text,
  -- Downstream record produced from this upload (e.g. the structured RightBridge report).
  report_id         uuid references rightbridge_reports(id) on delete set null,
  -- Provenance of the derived content (Guardrail: track parser/model/prompt version).
  parser_version    text,
  model_version     text,
  created_by        text,
  uploaded_at       timestamptz not null default now(),
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_compliance_uploads_case   on compliance_uploads(case_id);
create index if not exists idx_compliance_uploads_status on compliance_uploads(status);
create index if not exists idx_compliance_uploads_kind   on compliance_uploads(kind);
create index if not exists idx_compliance_uploads_sha    on compliance_uploads(sha256);
create index if not exists idx_compliance_uploads_created on compliance_uploads(created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. compliance_upload_pages — per-page extracted text (preserves page numbers,
--    enables search-within-document + a page↔source link for every extracted fact)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists compliance_upload_pages (
  id             uuid primary key default gen_random_uuid(),
  upload_id      uuid not null references compliance_uploads(id) on delete cascade,
  page_number    integer not null,                -- 1-based
  text           text not null default '',
  char_count     integer not null default 0,
  low_confidence boolean not null default false,  -- page-level (a scanned page in a native PDF)
  search_tsv     tsvector,                         -- search-within-document (trigger-maintained)
  created_at     timestamptz not null default now(),
  unique (upload_id, page_number)
);
create index if not exists idx_compliance_pages_upload on compliance_upload_pages(upload_id);
create index if not exists idx_compliance_pages_tsv    on compliance_upload_pages using gin(search_tsv);

-- Weighted search vector for page text (body weight B; same immutability constraint
-- as compliance_chunks/knowledge_documents — a trigger, not a generated column).
create or replace function compliance_upload_pages_tsv_update() returns trigger as $$
begin
  new.search_tsv := setweight(to_tsvector('english', coalesce(new.text,'')), 'B');
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_compliance_upload_pages_tsv on compliance_upload_pages;
create trigger trg_compliance_upload_pages_tsv
  before insert or update of text
  on compliance_upload_pages
  for each row execute function compliance_upload_pages_tsv_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Extend rightbridge_reports with the structured representation + provenance
-- ─────────────────────────────────────────────────────────────────────────────
alter table rightbridge_reports
  add column if not exists upload_id             uuid references compliance_uploads(id) on delete set null,
  -- The version-aware structured report: sections → questions → answers, each with
  -- a page ref + extraction confidence (do NOT reduce a report to one text blob).
  add column if not exists structured_report     jsonb not null default '{}'::jsonb,
  add column if not exists extraction_confidence  numeric(4,3),
  add column if not exists parser_version         text,
  add column if not exists model_version          text;
create index if not exists idx_rightbridge_upload on rightbridge_reports(upload_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Extend nigo_cases: the upload a case was created from (source provenance)
-- ─────────────────────────────────────────────────────────────────────────────
alter table nigo_cases
  add column if not exists source_upload_id uuid references compliance_uploads(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Extend nigo_issues: the issue-resolution workspace fields
-- ─────────────────────────────────────────────────────────────────────────────
--    (issue-level status machine, severity, assignment, and the human-in-the-loop
--     review record — the AI drafts, a licensed human confirms before use.)
alter table nigo_issues
  add column if not exists status text not null default 'new'
    check (status in (
      'new','analyzing','needs_documents','needs_client_info','needs_fsa_clarification',
      'needs_agency_input','needs_carrier_clarification','needs_osj_clarification',
      'correction_in_progress','ready_for_review','ready_to_respond','submitted',
      'resolved','rejected','escalated','closed'
    )),
  add column if not exists severity text not null default 'normal'
    check (severity in ('low','normal','high','critical')),
  add column if not exists assigned_to    text,
  add column if not exists human_reviewed boolean not null default false,
  add column if not exists reviewer_notes text,
  add column if not exists resolved_at    timestamptz;
create index if not exists idx_nigo_issues_status on nigo_issues(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. updated_at triggers for the new tables (reuse update_updated_at(), mig 001/012)
-- ─────────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_compliance_uploads_updated on compliance_uploads;
create trigger trg_compliance_uploads_updated before update on compliance_uploads
  for each row execute function update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS — same default-deny + role policy pattern as migration 036
--    (helpers is_super()/has_role() from migration 010; writes run under the
--     service role AFTER lib/auth/api gating).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['compliance_uploads','compliance_upload_pages']
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

do $$
declare
  t text;
  read_roles  text := 'is_super() or has_role(''compliance'') or has_role(''supervisor'') or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'') or has_role(''ops'')';
  write_roles text := 'is_super() or has_role(''compliance'') or has_role(''supervisor'') or has_role(''fsa'') or has_role(''licensed_staff'') or has_role(''admin'')';
begin
  foreach t in array array['compliance_uploads','compliance_upload_pages']
  loop
    execute format('drop policy if exists %I on %I;', t || '_read', t);
    execute format('create policy %I on %I for select using (%s);', t || '_read', t, read_roles);
    execute format('drop policy if exists %I on %I;', t || '_write', t);
    execute format('create policy %I on %I for all using (%s) with check (%s);', t || '_write', t, write_roles, write_roles);
  end loop;
end $$;
