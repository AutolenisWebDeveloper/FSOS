-- 143_security_advisor_hardening.sql
-- Close the Supabase security-advisor findings a migration can close (live DB audit 2026-10-05,
-- §2 and §4 step 4), and repair has_role(), which errors on every call in production.
--
-- 1. EXECUTE on SECURITY DEFINER functions (advisor 0028 / 0029, 12 functions each).
--    The grant that lets anon and signed-in users call them is mostly the PUBLIC pseudo-role
--    (ACL "=X/postgres", from Postgres's built-in function default), so revoking from `anon` alone
--    changes nothing: every revoke below names PUBLIC as well.
--      a. Server-only RPCs: called only through getDb() (service role, src/lib/supabase/client.ts).
--         The DOB pair takes the app-held key as a parameter; the social pair decrypts stored
--         OAuth secrets. Granted to service_role only.
--      b. Trigger functions. Postgres checks EXECUTE when a trigger is CREATED, not when it fires,
--         so revoking EXECUTE never stops a trigger; it only removes the /rest/v1/rpc entry point.
--      c. RLS helpers (is_super, has_role, current_user_agencies, current_user_household).
--         About 160 policies are declared TO public and call them. Postgres checks EXECUTE on a
--         SECURITY DEFINER function when the query starts, so any role without EXECUTE that
--         queries one of those tables gets 42501, whatever the other policies allow. Revoked from
--         anon AND authenticated ("and from authenticated where not needed": nothing needs it).
--         FSOS never queries Postgres as anon or authenticated: the anon-key clients do Supabase
--         Auth only, and every table read, write and RPC goes through getDb() behind
--         requireApiRole(), which enforces MFA / step-up, Zod validation and writeAudit.
--         Production today: has_role() is broken (search_path="", see 3), so these policies
--         already fail (42P01) for every non-service role; after this file they fail with 42501.
--         Same posture, now deliberate. Keeping authenticated's EXECUTE while repairing has_role()
--         would instead OPEN direct /rest/v1 access to those tables for any signed-in staff JWT,
--         per the policies, with no MFA check (no policy tests aal), bypassing the app layer.
--         If direct client-side RLS reads are ever wanted, re-grant to authenticated together with
--         an aal2 check in the policies. The service role bypasses RLS and is unaffected.
--      d. current_user_roles(): no policy, route or function calls it. Production already holds
--         EXECUTE for postgres and service_role only (hand-changed; the repo still granted
--         PUBLIC). Brought in line. (Production also has it SECURITY INVOKER; left as it is.)
-- 2. comm_sendable_assets runs with its owner's rights (advisor 0010, ERROR): any API role could
--    read it past RLS. security_invoker makes it run as the caller, like every other view here.
--    Its readers use getDb() (service role, BYPASSRLS, SELECT on every underlying table), so
--    what they see does not change. 087 expects later migrations to CREATE OR REPLACE this view to
--    add a campaign; each must repeat `with (security_invoker = true)`, or the option is dropped.
-- 3. search_path (advisor 0011, 39 functions). Pinned to `public, extensions, pg_temp`:
--    `public` and `extensions` are what the postgres role resolves today (verified; pg_cron runs
--    the nightly job as postgres) and what Supabase's PostgREST searches by default. `extensions`
--    is REQUIRED: six of these functions call pgcrypto's pgp_sym_encrypt / pgp_sym_decrypt
--    unqualified, and pgcrypto lives in `extensions` on Supabase. `pg_temp` goes last so a
--    temporary object can never shadow a real one. No API role can CREATE in public or
--    extensions (checked 2026-10-06).
--    Also pinned:
--      • has_role(text): production carries search_path="" (set by hand; no migration did it),
--        but the body names `user_roles` unqualified, so every call fails with 42P01
--        "relation user_roles does not exist", and with it is_super() and every RLS policy that
--        calls either one, for any role RLS applies to. The service role bypasses RLS, which is
--        why nothing user-facing has surfaced it. Re-pinning repairs the function; 1c keeps the
--        policies that call it closed to API roles.
--      • seven functions production already pins to `public` by hand (calculate_case_gdc,
--        score_business, score_life, score_opra, score_retirement, sync_form_to_profile,
--        update_agency_last_referral), so the repository's chain matches production again.
--    A later CREATE OR REPLACE of any of these MUST repeat `set search_path = public,
--    extensions, pg_temp`: CREATE OR REPLACE resets a function's settings (its grants survive).
--    tests/security-advisor-hardening.test.mjs fails if any function in public is left unpinned.
--
-- Not closable here: leaked-password protection (Auth dashboard setting), `vector` / `btree_gist`
-- in public (moving an extension is its own change), and the 38 "RLS enabled, no policy" INFO
-- findings (intended: those tables are service-role only).
--
-- The rollback restores production's exact prior state, INCLUDING has_role's broken
-- search_path="": re-granting the helpers to authenticated with a working has_role() would open the
-- direct signed-in REST access that production does not have today (see 1c).
--
-- ROLLBACK:
--   grant execute on function public.member_create(uuid, text, text, date, text, text, text) to public, anon, authenticated;
--   grant execute on function public.member_dob(uuid, text) to public, anon, authenticated;
--   grant execute on function public.member_update(uuid, text, text, date, text, text, text) to public, anon, authenticated;
--   grant execute on function public.social_channel_secret(uuid, text) to public;
--   grant execute on function public.social_channel_set_secret(uuid, text, text) to public;
--   grant execute on function public.social_media_increment_usage(uuid, integer) to public;
--   grant execute on function public.comm_template_snapshot_version() to public;
--   grant execute on function public.sync_engine_campaign_registry() to public;
--   grant execute on function public.is_super() to public, anon, authenticated;
--   grant execute on function public.has_role(text) to public, anon, authenticated;
--   grant execute on function public.current_user_agencies() to public, anon, authenticated;
--   grant execute on function public.current_user_household() to public, anon, authenticated;
--   alter view public.comm_sendable_assets reset (security_invoker);
--   do $$
--   declare f text;
--   begin
--     foreach f in array array[
--       'public.audit_log_block_mutation()', 'public.audit_log_block_truncate()',
--       'public.booking_calendar_secret(uuid, text)', 'public.booking_calendar_set_secret(uuid, text, text)',
--       'public.cascade_workshop_cancel()', 'public.comm_delegation_touch_updated_at()',
--       'public.comm_template_versions_block_mutation()', 'public.comm_template_versions_block_truncate()',
--       'public.compliance_chunks_tsv_update()', 'public.compliance_upload_pages_tsv_update()',
--       'public.current_user_agencies()', 'public.current_user_household()', 'public.current_user_roles()',
--       'public.decrypt_dob(bytea, text)', 'public.encrypt_dob(date, text)',
--       'public.enforce_workshop_publish_gate()', 'public.enforce_workshop_terminality()',
--       'public.fna_versions_guard_immutable()', 'public.fsos_backfill_policy_contact()',
--       'public.fsos_link_contact()', 'public.fsos_link_policy()',
--       'public.fsos_resolve_household_owner(uuid)', 'public.fsos_resolve_policy_agency(jsonb, uuid)',
--       'public.is_super()', 'public.knowledge_documents_tsv_update()',
--       'public.member_create(uuid, text, text, date, text, text, text)', 'public.member_dob(uuid, text)',
--       'public.member_update(uuid, text, text, date, text, text, text)',
--       'public.run_nightly_scoring()', 'public.score_conversion(uuid)', 'public.set_customer_age()',
--       'public.social_append_only_block_mutation()', 'public.social_channel_secret(uuid, text)',
--       'public.social_channel_set_secret(uuid, text, text)', 'public.social_media_increment_usage(uuid, integer)',
--       'public.social_schedule_require_approved()', 'public.social_versions_guard_immutable()',
--       'public.tasks_touch_updated_at()', 'public.update_updated_at()'
--     ] loop
--       execute format('alter function %s reset search_path', f);
--     end loop;
--     foreach f in array array[
--       'public.calculate_case_gdc(text, text, text, text, integer, text, numeric, numeric, numeric)',
--       'public.score_business(uuid)', 'public.score_life(uuid)', 'public.score_opra(uuid)',
--       'public.score_retirement(uuid)', 'public.sync_form_to_profile()', 'public.update_agency_last_referral()'
--     ] loop
--       execute format('alter function %s set search_path = public', f);
--     end loop;
--   end $$;
--   alter function public.has_role(text) set search_path = '';

-- ── 1a. Server-only RPCs: service role only ──────────────────────────────────
revoke execute on function public.member_create(uuid, text, text, date, text, text, text) from public, anon, authenticated;
revoke execute on function public.member_dob(uuid, text) from public, anon, authenticated;
revoke execute on function public.member_update(uuid, text, text, date, text, text, text) from public, anon, authenticated;
revoke execute on function public.social_channel_secret(uuid, text) from public, anon, authenticated;
revoke execute on function public.social_channel_set_secret(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.social_media_increment_usage(uuid, integer) from public, anon, authenticated;
grant execute on function public.member_create(uuid, text, text, date, text, text, text) to service_role;
grant execute on function public.member_dob(uuid, text) to service_role;
grant execute on function public.member_update(uuid, text, text, date, text, text, text) to service_role;
grant execute on function public.social_channel_secret(uuid, text) to service_role;
grant execute on function public.social_channel_set_secret(uuid, text, text) to service_role;
grant execute on function public.social_media_increment_usage(uuid, integer) to service_role;

-- ── 1b. Trigger functions: not callable over the API; the triggers still fire ──
revoke execute on function public.comm_template_snapshot_version() from public, anon, authenticated;
revoke execute on function public.sync_engine_campaign_registry() from public, anon, authenticated;
grant execute on function public.comm_template_snapshot_version() to service_role;
grant execute on function public.sync_engine_campaign_registry() to service_role;

-- ── 1c. RLS helpers: no API role needs them; their policies now fail closed for non-service roles ──
revoke execute on function public.is_super() from public, anon, authenticated;
revoke execute on function public.has_role(text) from public, anon, authenticated;
revoke execute on function public.current_user_agencies() from public, anon, authenticated;
revoke execute on function public.current_user_household() from public, anon, authenticated;
grant execute on function public.is_super() to service_role;
grant execute on function public.has_role(text) to service_role;
grant execute on function public.current_user_agencies() to service_role;
grant execute on function public.current_user_household() to service_role;

-- ── 1d. current_user_roles(): unused; match production ─────────────────────────
revoke execute on function public.current_user_roles() from public, anon, authenticated;
grant execute on function public.current_user_roles() to service_role;

-- ── 2. comm_sendable_assets runs as the caller ────────────────────────────────
alter view public.comm_sendable_assets set (security_invoker = true);

-- ── 3. Pin search_path ────────────────────────────────────────────────────────
-- The 39 advisor findings.
alter function public.audit_log_block_mutation() set search_path = public, extensions, pg_temp;
alter function public.audit_log_block_truncate() set search_path = public, extensions, pg_temp;
alter function public.booking_calendar_secret(uuid, text) set search_path = public, extensions, pg_temp;
alter function public.booking_calendar_set_secret(uuid, text, text) set search_path = public, extensions, pg_temp;
alter function public.cascade_workshop_cancel() set search_path = public, extensions, pg_temp;
alter function public.comm_delegation_touch_updated_at() set search_path = public, extensions, pg_temp;
alter function public.comm_template_versions_block_mutation() set search_path = public, extensions, pg_temp;
alter function public.comm_template_versions_block_truncate() set search_path = public, extensions, pg_temp;
alter function public.compliance_chunks_tsv_update() set search_path = public, extensions, pg_temp;
alter function public.compliance_upload_pages_tsv_update() set search_path = public, extensions, pg_temp;
alter function public.current_user_agencies() set search_path = public, extensions, pg_temp;
alter function public.current_user_household() set search_path = public, extensions, pg_temp;
alter function public.current_user_roles() set search_path = public, extensions, pg_temp;
alter function public.decrypt_dob(bytea, text) set search_path = public, extensions, pg_temp;
alter function public.encrypt_dob(date, text) set search_path = public, extensions, pg_temp;
alter function public.enforce_workshop_publish_gate() set search_path = public, extensions, pg_temp;
alter function public.enforce_workshop_terminality() set search_path = public, extensions, pg_temp;
alter function public.fna_versions_guard_immutable() set search_path = public, extensions, pg_temp;
alter function public.fsos_backfill_policy_contact() set search_path = public, extensions, pg_temp;
alter function public.fsos_link_contact() set search_path = public, extensions, pg_temp;
alter function public.fsos_link_policy() set search_path = public, extensions, pg_temp;
alter function public.fsos_resolve_household_owner(uuid) set search_path = public, extensions, pg_temp;
alter function public.fsos_resolve_policy_agency(jsonb, uuid) set search_path = public, extensions, pg_temp;
alter function public.is_super() set search_path = public, extensions, pg_temp;
alter function public.knowledge_documents_tsv_update() set search_path = public, extensions, pg_temp;
alter function public.member_create(uuid, text, text, date, text, text, text) set search_path = public, extensions, pg_temp;
alter function public.member_dob(uuid, text) set search_path = public, extensions, pg_temp;
alter function public.member_update(uuid, text, text, date, text, text, text) set search_path = public, extensions, pg_temp;
alter function public.run_nightly_scoring() set search_path = public, extensions, pg_temp;
alter function public.score_conversion(uuid) set search_path = public, extensions, pg_temp;
alter function public.set_customer_age() set search_path = public, extensions, pg_temp;
alter function public.social_append_only_block_mutation() set search_path = public, extensions, pg_temp;
alter function public.social_channel_secret(uuid, text) set search_path = public, extensions, pg_temp;
alter function public.social_channel_set_secret(uuid, text, text) set search_path = public, extensions, pg_temp;
alter function public.social_media_increment_usage(uuid, integer) set search_path = public, extensions, pg_temp;
alter function public.social_schedule_require_approved() set search_path = public, extensions, pg_temp;
alter function public.social_versions_guard_immutable() set search_path = public, extensions, pg_temp;
alter function public.tasks_touch_updated_at() set search_path = public, extensions, pg_temp;
alter function public.update_updated_at() set search_path = public, extensions, pg_temp;

-- has_role(text): repairs production's search_path="" (see header).
alter function public.has_role(text) set search_path = public, extensions, pg_temp;

-- Already pinned to `public` in production by hand; recorded here so the chain matches.
alter function public.calculate_case_gdc(text, text, text, text, integer, text, numeric, numeric, numeric) set search_path = public, extensions, pg_temp;
alter function public.score_business(uuid) set search_path = public, extensions, pg_temp;
alter function public.score_life(uuid) set search_path = public, extensions, pg_temp;
alter function public.score_opra(uuid) set search_path = public, extensions, pg_temp;
alter function public.score_retirement(uuid) set search_path = public, extensions, pg_temp;
alter function public.sync_form_to_profile() set search_path = public, extensions, pg_temp;
alter function public.update_agency_last_referral() set search_path = public, extensions, pg_temp;
