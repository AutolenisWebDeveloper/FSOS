-- 017_fna_documents.sql
-- Legacy-port FNA Generator (docs/legacy-port.md 2.1). The generated Financial
-- Needs Analysis is saved to Document OS as a real document row (classification
-- 'fna_report') rather than emailed ad hoc. The documents table is a metadata /
-- pointer table; the FNA body is a small structured JSON payload, so we store it
-- inline on the row (content) plus a human title. Both are additive and nullable.
--
-- GUARDRAIL 2 (AI green-zone): the FNA identifies needs and gaps only. It never
-- names a product to buy. The report is screened by lib/fna/screen.ts (which
-- reuses lib/compliance/guardrail.ts) before it can be saved here, and the FINRA
-- disclaimer is forced onto every stored report.
--
-- NOTE: comments are on their own lines and contain no semicolons, so every
-- terminator in this file is a real one (safe for naive SQL splitters).

-- ---------------------------------------------------------------------------
-- 1. Inline FNA body + title on documents.
-- ---------------------------------------------------------------------------
alter table documents add column if not exists content jsonb;
alter table documents add column if not exists title   text;

-- Fast lookup of a household's saved FNA reports (list newest first).
create index if not exists idx_documents_fna
  on documents (entity_id, created_at desc)
  where classification = 'fna_report';
