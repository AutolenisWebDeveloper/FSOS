-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Link agency owners to the unified Contact Center
-- Migration: 052_agency_owner_contact_link
--
-- The agency directory importer creates agency_owners rows, and the Contact
-- Center (contacts) is the unified book where every person — clients, prospects,
-- and agency owners (contact_type='agency_owner') — is reconciled and de-duped.
-- Until now the two representations were unlinked: an owner had no pointer to its
-- contact, so imported agents never joined the book and their details were never
-- merged into an existing contact.
--
-- This adds the bidirectional link. The contact side already exists
-- (contacts.agency_partnership_id, migration 026); this adds the owner side so
-- agency_owners.contact_id references the reconciled contact. The importer and
-- the Data Quality reconciler set it after resolving the owner against the book.
--
-- Additive + idempotent. RLS unchanged (writes via service role after RBAC).
-- ═══════════════════════════════════════════════════════════════════

alter table agency_owners
  add column if not exists contact_id uuid references contacts(id) on delete set null;

comment on column agency_owners.contact_id is
  'The reconciled Contact Center row for this owner (contact_type=agency_owner). Set by the agency importer / Data Quality reconciler via the shared resolution engine.';

create index if not exists idx_agency_owners_contact_id
  on agency_owners (contact_id) where contact_id is not null;
