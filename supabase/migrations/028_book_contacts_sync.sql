-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Book → Contacts sync (make the Contact Center the source of truth)
-- Migration: 028_book_contacts_sync
--
-- The In-Force Book import now also creates a `contacts` row for every person in
-- the book (owner, joint owner, serving agent), linked to their household and
-- agency — so the Contacts section is populated and stays in sync with Agencies,
-- Households, Policies, and the Book. `book_key` is the idempotent provenance key
-- the importer upserts on (re-running never duplicates a contact).
-- Idempotent; nothing dropped or renamed.
-- ═══════════════════════════════════════════════════════════════════

alter table contacts add column if not exists book_key text;
create unique index if not exists uq_contacts_book_key
  on contacts(book_key) where book_key is not null;
