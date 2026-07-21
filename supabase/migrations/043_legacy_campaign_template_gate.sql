-- ─────────────────────────────────────────────────────────
-- Migration: 043_legacy_campaign_template_gate
--
-- Enterprise-audit Initiative A (finding C-1). The legacy drip runner
-- (/api/campaigns/run) now routes every send through the compliance gate
-- (sendThroughGate). Gate step 4 requires an APPROVED template or AI policy, so a
-- legacy campaign needs a way to reference an approved comm_template. Mirrors the
-- spine's own `comm_campaigns.template_id → comm_templates` (mig 009).
--
-- Additive + idempotent. A nullable link: campaigns with no approved template linked
-- will (correctly) block on gate step 4 + escalate until an operator approves + links
-- content — unapproved bulk content must not send (CLAUDE.md §7).
-- ─────────────────────────────────────────────────────────

alter table campaigns
  add column if not exists template_id uuid references comm_templates(id) on delete set null;

comment on column campaigns.template_id is
  'Approved comm_template that satisfies gate step 4 for this legacy campaign''s sends (C-1). Null → sends block on approved_template until linked.';

create index if not exists idx_campaigns_template on campaigns(template_id) where template_id is not null;
