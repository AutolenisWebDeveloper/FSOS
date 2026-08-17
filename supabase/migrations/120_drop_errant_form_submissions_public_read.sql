-- 120_drop_errant_form_submissions_public_read.sql
-- SECURITY: remove the hand-added, non-repo policy `public_form_token_read` on form_submissions.
-- It granted SELECT to role `public` with USING (true) — anonymous read of every row (PII: a DOB in
-- response_data, ip_address, customer_id, and the form-access tokens). It was never defined in any
-- migration (hand-applied to prod). The repo's intended posture is server-only access via the
-- `service_role_all` policy (001_initial_schema:923); the app reads form_submissions exclusively
-- through the service-role client and enforces token-scoping in application code
-- (/api/forms/submit does `.eq('token', token)` server-side), so no anon read is needed and nothing
-- depends on this policy. Idempotent + forward-only (drop policy IF EXISTS — safe to re-run).

drop policy if exists public_form_token_read on public.form_submissions;

-- Post-apply expectation: form_submissions has exactly ONE policy (`service_role_all`), RLS still ON.
-- Verify with:
--   select policyname, cmd, roles::text, coalesce(qual,'(none)')
--   from pg_policies where schemaname='public' and tablename='form_submissions';
--   select relrowsecurity from pg_class where oid = 'public.form_submissions'::regclass;
