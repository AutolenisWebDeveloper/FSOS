-- ─────────────────────────────────────────────────────────
-- Migration: 060_comm_template_render
--
-- Native Communications Platform — SLICE 9B: hybrid email rendering (ADR-025). Campaign
-- email templates are authored as React Email components and rendered AT BUILD TIME to a
-- stored HTML + plaintext pair; the send path dispatches those stored bytes (never renders
-- React at send time). The plaintext is part of the APPROVED, IMMUTABLE artifact — versioned
-- alongside the HTML — and render_sha pins the exact rendered bytes so a dependency bump that
-- changes output changes the sha, forcing a new draft version + re-approval.
--
-- Additive, forward-only, idempotent. All columns NULLABLE → existing string templates are
-- unaffected (body_text null → single-part send as today; the send path only adds a plaintext
-- part when body_text is present). RLS inherited from comm_templates (mig 010). No securities
-- data (firewall §4.1). No GHL surface (§0.A).
-- ─────────────────────────────────────────────────────────

alter table comm_templates
  add column if not exists body_text  text,   -- rendered plaintext part (approved + immutable with body)
  add column if not exists render_sha text,   -- sha256(body + ' ' + body_text) — pins the approved bytes
  add column if not exists source_key text;   -- the React Email component this template was rendered from

create index if not exists idx_comm_templates_source on comm_templates(source_key)
  where source_key is not null;

comment on column comm_templates.body_text is
  'Rendered plaintext part of the email (ADR-025). Part of the approved, immutable artifact — versioned with body; stored, never generated at send time. NULL → single-part (HTML-only) send.';
comment on column comm_templates.render_sha is
  'sha256 pinning the exact rendered (body, body_text) bytes. A dependency bump that changes the deterministic render changes this, forcing a new draft version + re-approval.';
comment on column comm_templates.source_key is
  'The React Email component (src/emails registry key) this template was rendered from. Ties a stored template to its author-time source so re-rendering updates the same draft.';
