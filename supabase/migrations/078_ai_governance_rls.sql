-- ─────────────────────────────────────────────────────────
-- Migration: 078_ai_governance_rls
--
-- Enable Row-Level Security on the AI-governance config tables. Owner-approved
-- (god-mode audit).
--
-- WHY: ai_policies (global gateway kill switch `gateway_enabled`) and ai_agents
-- (per-agent `enabled`, including the is_guardrail Compliance Guardrail agent) were the
-- only sensitive tables with NO row-level security. Under Supabase's default PostgREST
-- grants to anon/authenticated, a holder of the shipped anon key plus any authenticated
-- session could read and potentially UPDATE these rows directly — flipping the global
-- kill switch or disabling the Compliance Guardrail, defeating an AI-governance control
-- enforced only in application code (api/ai/agents/[id]).
--
-- PURE HARDENING: every legitimate reader/writer uses getDb() (service role), which
-- BYPASSES RLS — so the app is unaffected (verified: ai_policies has 0 code writers;
-- ai_agents has one writer, the service-role, super+2FA-gated api/ai/agents/[id] route;
-- neither is ever read via the browser/anon client). The ONLY access newly denied is
-- direct anon/authenticated PostgREST access — the vulnerability itself.
--
-- No explicit BEGIN/COMMIT: the runner applies each file atomically. Idempotent.
-- ─────────────────────────────────────────────────────────

alter table ai_policies enable row level security;
alter table ai_policies force row level security;
alter table ai_agents  enable row level security;
alter table ai_agents  force row level security;

-- Remove default PostgREST write grants to the browser-facing roles. Service role
-- (bypassrls) is unaffected and remains the app's sole read/write path.
revoke insert, update, delete on ai_policies from anon, authenticated;
revoke insert, update, delete on ai_agents  from anon, authenticated;

-- Optional read-only visibility for a super_admin using a user-context client (the app
-- itself uses the service role; writes stay service-role-only). Roles are carried in the
-- JWT app_metadata.roles claim — the same source middleware/rbac.ts reads. A null/absent
-- claim evaluates false → deny (fail-closed).
drop policy if exists ai_policies_super_read on ai_policies;
create policy ai_policies_super_read on ai_policies for select to authenticated
  using ((auth.jwt() -> 'app_metadata' -> 'roles') ? 'super_admin');

drop policy if exists ai_agents_super_read on ai_agents;
create policy ai_agents_super_read on ai_agents for select to authenticated
  using ((auth.jwt() -> 'app_metadata' -> 'roles') ? 'super_admin');

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   drop policy if exists ai_policies_super_read on ai_policies;
--   drop policy if exists ai_agents_super_read on ai_agents;
--   alter table ai_policies no force row level security;  alter table ai_policies disable row level security;
--   alter table ai_agents  no force row level security;   alter table ai_agents  disable row level security;
--   -- Re-granting anon/authenticated writes is intentionally omitted (re-opens the vuln).
