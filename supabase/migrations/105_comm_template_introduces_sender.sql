-- ─────────────────────────────────────────────────────────
-- Migration: 105_comm_template_introduces_sender
--
-- ADR-016 (identity-disclosure-engine) — allow an APPROVED authored template to carry the
-- first-contact introduction itself, instead of the platform prepending its config wording.
--
-- WHY: the disclosure engine prepends the approved introduction on the first touch per
-- channel. The lifecycle campaigns ALSO opened their first email/SMS/AI touch with an
-- introduction of their own, so a recipient got two near-identical introductions stacked on
-- one message — and on email the prepended paragraph landed ahead of the body's leading
-- "Subject:" line, which is what the marketing shell parses for the card H1 and preheader.
--
-- The fix keeps ONE introduction per channel and keeps it where the FSA can see and edit it:
-- the campaign's own first-touch copy. This flag is how a send path declares that. When it is
-- set, resolveIdentityDisclosure() records the introduction (identity_full_intro, the audit
-- reason, and the per-channel thread stamp) but prepends nothing, so touch 2 onward still
-- correctly counts as "already introduced" and never re-introduces.
--
-- DEFAULT false is the fail-safe direction: a template that does not declare an introduction
-- gets the platform disclosure exactly as before. Nothing about the disclosure REQUIREMENT
-- changes — only which of the two approved wordings is delivered.
--
-- Forward-only, additive, no backfill (the v3 campaign copy migrations set the flag on their
-- own first-touch assets). Idempotent.
-- ─────────────────────────────────────────────────────────

alter table comm_templates
  add column if not exists introduces_sender boolean not null default false;

comment on column comm_templates.introduces_sender is
  'True when this template''s own approved copy carries the first-contact identity introduction (ADR-016): names the FSA, their role, and the recipient''s agent of record via {{agent_of_record_reference}}. The platform then records the introduction for audit and stamps the thread, but does not prepend its own disclosure paragraph. Default false = the platform discloses, as before.';
