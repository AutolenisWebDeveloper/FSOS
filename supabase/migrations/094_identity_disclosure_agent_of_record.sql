-- ─────────────────────────────────────────────────────────
-- Migration: 094_identity_disclosure_agent_of_record
--
-- First-contact identity disclosure (ADR-016) — finalize the wording so the platform
-- disclosure NAMES THE CLIENT'S OWN AGENT OF RECORD, and approve it so it auto-inserts.
--
-- The disclosure text is authored/approved by the FSA (provided verbatim), so it is no longer
-- an unverified config default (is_assumption → false). It uses the graceful
-- {{agency_owner.reference}} token (rendered by src/lib/comms/identity.ts): the agent-of-record
-- name is resolved per recipient from the spine (households.referring_agency_id →
-- agency_owners.full_name, resolveAgentOfRecordName in send.ts) so it MATCHES the client's own
-- Farmers agent. When the specific agent cannot be confidently resolved, the token degrades to
-- the generic "your Farmers agent" (§4.3 — a guessed name is never rendered), so the sentence
-- reads correctly either way ("I work with your Farmers agent, Jane Smith" or "I work with your
-- Farmers agent") — never the doubled "your Farmers agent, your Farmers agent".
--
-- Idempotent (UPDATE by primary key). Forward-only; no schema change, config row only.
-- ─────────────────────────────────────────────────────────

update comm_identity_config
set
  full_template =
    'This is {{sender.full_name}} with Farmers Financial Solutions. I work with {{agency_owner.reference}}, and assist the agency''s clients with life insurance and financial services.',
  abbreviated_template =
    'This is {{sender.first_name}} with Farmers Financial Solutions, working with {{agency_owner.reference}}.',
  fsa_role_label       = 'a Financial Services Agent with Farmers Financial Solutions',
  is_assumption        = false,
  approval_status      = 'approved',
  approved_at          = now(),
  approved_by          = 'fsa',
  version              = version + 1,
  updated_at           = now()
where id = 'global';
