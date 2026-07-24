-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 065_social_engagement_crm  (Social Content Module — Slice 5, ADR-026)
--
-- Slice 5 wires inbound social engagement into the CRM. The social_engagement
-- table already exists (mig 063); this migration adds the triage/linkage columns:
--   • classification / route  — the Engagement Triager's output
--   • matched_by              — how the author resolved (email/phone/manual)
--   • linked_task_id          — FK → work_tasks (a follow-up created from engagement)
--   • linked_opportunity_id   — FK → opportunities (a lead created from engagement)
--
-- resolved_contact_id stays a PLAIN uuid (no FK): contacts (mig 026) is not in the
-- RLS-proof migration set, and social leads resolve to EXISTING contacts via the
-- service layer (ADR-001) — a duplicate person record is never created. The task /
-- opportunity FKs are safe (work_tasks + opportunities are in mig 009).
--
-- Additive · idempotent · forward-only. No new table, no RLS change (the existing
-- social_engagement policies from 063 cover the new columns).
-- ─────────────────────────────────────────────────────────────────────────────

alter table social_engagement
  add column if not exists classification        text,
  add column if not exists route                 text,
  add column if not exists matched_by            text,
  add column if not exists linked_task_id        uuid references work_tasks(id) on delete set null,
  add column if not exists linked_opportunity_id uuid references opportunities(id) on delete set null;

create index if not exists idx_social_engagement_task
  on social_engagement(linked_task_id) where linked_task_id is not null;
create index if not exists idx_social_engagement_opportunity
  on social_engagement(linked_opportunity_id) where linked_opportunity_id is not null;
create index if not exists idx_social_engagement_classification
  on social_engagement(classification) where classification is not null;

comment on column social_engagement.resolved_contact_id is
  'The EXISTING contact this engagement author resolved to (ADR-001). Plain uuid, app-enforced — never a duplicate person record.';
