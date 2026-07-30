-- ⚠️  DRAFT — NOT APPLIED. Deliberately outside supabase/migrations/ so
--     `npm run migrate` will NOT pick it up. Review, then (on approval) move to
--     supabase/migrations/077_ai_governance_rls.sql to apply. See EVIDENCE.md.
--
-- Proposed forward migration: enable RLS on the AI-governance config tables.
--
-- WHY: ai_policies (global gateway kill switch `gateway_enabled`) and ai_agents
-- (per-agent `enabled`, including the is_guardrail Compliance Guardrail agent) are the
-- only sensitive tables with NO row-level security. Under Supabase's default PostgREST
-- grants to anon/authenticated, a holder of the shipped anon key plus any authenticated
-- session could read and potentially UPDATE these rows directly — flipping the global
-- kill switch or disabling the Compliance Guardrail, defeating an AI-governance control
-- that is currently enforced only in application code (api/ai/agents/[id]).
--
-- BLAST RADIUS: pure hardening. Every legitimate reader/writer uses getDb() (service
-- role), which BYPASSES RLS — so the app is unaffected (verified: ai_policies has 0
-- code writers; ai_agents has exactly one writer, the service-role, super+2FA-gated
-- api/ai/agents/[id] route; neither table is ever read via the browser/anon client).
-- The ONLY access this newly denies is direct anon/authenticated PostgREST access —
-- i.e. the vulnerability itself. No existing allow/deny outcome for a real caller
-- changes.

begin;

alter table ai_policies enable row level security;
alter table ai_policies force row level security;
alter table ai_agents  enable row level security;
alter table ai_agents  force row level security;

-- Remove any default PostgREST write grants to the browser-facing roles. Service role
-- (bypassrls) is unaffected and remains the app's sole read/write path.
revoke insert, update, delete on ai_policies from anon, authenticated;
revoke insert, update, delete on ai_agents  from anon, authenticated;

-- Optional read-only visibility for a super_admin using a user-context client (the app
-- itself uses the service role). Writes stay service-role-only. Roles are carried in
-- the JWT app_metadata.roles claim (same source middleware/rbac.ts reads).
drop policy if exists ai_policies_super_read on ai_policies;
create policy ai_policies_super_read on ai_policies for select to authenticated
  using ((auth.jwt() -> 'app_metadata' -> 'roles') ? 'super_admin');

drop policy if exists ai_agents_super_read on ai_agents;
create policy ai_agents_super_read on ai_agents for select to authenticated
  using ((auth.jwt() -> 'app_metadata' -> 'roles') ? 'super_admin');

commit;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- begin;
-- drop policy if exists ai_policies_super_read on ai_policies;
-- drop policy if exists ai_agents_super_read on ai_agents;
-- alter table ai_policies no force row level security;
-- alter table ai_policies disable row level security;
-- alter table ai_agents  no force row level security;
-- alter table ai_agents  disable row level security;
-- -- (Re-granting anon/authenticated writes is intentionally NOT part of rollback —
-- --  that would restore the vulnerability. The pre-migration state relied on implicit
-- --  default grants; if a specific grant is truly needed, add it explicitly.)
-- commit;
