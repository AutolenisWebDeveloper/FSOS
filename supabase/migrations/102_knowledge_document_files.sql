-- 102_knowledge_document_files.sql
-- AI Knowledge Library — attach the ORIGINAL FILE to a knowledge document.
--
-- WHY: migration 033 gave knowledge_documents a `content` textarea and placeholder
-- `source` / `source_ref` columns, but nothing ever wrote a file. The FSA could only
-- paste text — there was no way to upload the actual PDF/scan/notice the knowledge
-- came from, and therefore no way to re-read the source, verify a figure, or hand the
-- original to a reviewer. This migration adds the durable record for an uploaded file
-- so the library can ingest a document end-to-end:
--
--   upload → secure to the private `documents` bucket (mig 001) under a `knowledge/`
--   prefix → extract page text (native PDF → model-vision OCR fallback) → store the
--   text in `content` for full-text retrieval → keep the original for download.
--
-- The original is reached ONLY through a short-lived signed URL from the API route —
-- never a public URL, and the storage path is never returned to the browser.
--
-- GUARDRAILS (unchanged): retrieval still runs over `search_tsv` (the trigger from
-- 033 keeps it in sync when `content` is written here), assumption-flagged documents
-- still render "config default — verify" and are still passed to the model wrapped in
-- the do-not-assert note (§4.3), and nothing here weakens the securities firewall or
-- the RLS policies from 033 (the new columns inherit `kd_read` / `kd_write`).
--
-- Idempotent: safe to re-run. Additive only — no column is dropped or retyped.

-- ─────────────────────────────────────────────────────────
-- 1. File columns — the stored original + its extraction record.
-- ─────────────────────────────────────────────────────────
alter table knowledge_documents
  -- Path in the private `documents` bucket. NEVER returned to the client; the API
  -- exchanges it for a short-lived signed URL on read.
  add column if not exists storage_path          text,
  add column if not exists file_name             text,
  add column if not exists content_type          text,
  add column if not exists size_bytes            bigint,
  -- SHA-256 of the raw bytes → duplicate detection (warn + link, never silently
  -- create a second copy of the same file).
  add column if not exists sha256                text,
  add column if not exists page_count            integer,
  add column if not exists char_count            integer,
  -- native_pdf | claude_pdf (model-vision OCR) | text | image | none
  add column if not exists extraction_method     text,
  add column if not exists extraction_confidence real,
  -- True when the extraction was too thin to trust: the document is still stored and
  -- downloadable, but the UI warns that the indexed text may be incomplete rather
  -- than presenting a near-empty extraction as complete knowledge.
  add column if not exists low_confidence        boolean not null default false,
  add column if not exists extraction_error      text,
  -- True when the extracted text was clipped to the storage ceiling (the original
  -- file is always kept whole and downloadable).
  add column if not exists content_truncated     boolean not null default false,
  -- When the document was archived (soft delete). NULL while it is live.
  add column if not exists archived_at           timestamptz;

comment on column knowledge_documents.storage_path is
  'Private `documents` bucket path for the uploaded original. Server-only — exchanged for a short-lived signed URL by /api/knowledge; never sent to the browser.';
comment on column knowledge_documents.sha256 is
  'SHA-256 of the uploaded bytes. Duplicate-detection key for /api/knowledge/upload.';

-- ─────────────────────────────────────────────────────────
-- 2. Indexes — duplicate lookup + the library list query.
-- ─────────────────────────────────────────────────────────
-- Partial: only uploaded documents carry a hash, so the index stays small.
create index if not exists idx_knowledge_sha256
  on knowledge_documents(sha256)
  where sha256 is not null;

-- The active library list is "not archived, most recently edited first", and the
-- archived tab's count filters on status alone. (The archived list itself orders by
-- archived_at; at single-FSA scale that sort is trivial and needs no index of its own.)
create index if not exists idx_knowledge_status_updated
  on knowledge_documents(status, updated_at desc);

-- ─────────────────────────────────────────────────────────
-- 3. Backfill — stamp archived_at for anything already archived so the archived
--    view can order by it instead of falling back to updated_at.
-- ─────────────────────────────────────────────────────────
update knowledge_documents
   set archived_at = coalesce(archived_at, updated_at)
 where status = 'archived' and archived_at is null;
