-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Per-client document vault
-- Migration: 007_customer_documents
-- Run in: Supabase → SQL Editor → New Query → paste → Run
--
-- Metadata for files stored in the private `documents` bucket, scoped to a
-- customer. Files are uploaded via /api/customers/documents and served back
-- through short-lived signed URLs (objects are never public). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists customer_documents (
  doc_id        uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(customer_id) on delete cascade,
  filename      text not null,
  storage_path  text not null,
  content_type  text,
  size_bytes    bigint,
  uploaded_by   text,
  created_at    timestamptz default now()
);

create index if not exists idx_customer_docs on customer_documents(customer_id, created_at desc);

-- Service-role only (uploaded/read through the API, which hands back signed URLs).
alter table customer_documents enable row level security;
