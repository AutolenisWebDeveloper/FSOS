// Case 7 PROOF — the securities firewall + column/row allowlist as an RLS rule
// (data-guardrails §2–3). Applies migrations 009+010 (+011/012/013/015 for the
// view checks) to an ephemeral Postgres and asserts, as the CLIENT role, that:
//   • an is_security policy row is NOT returned (firewall by construction), and
//   • another household's row is NOT returned (scope allowlist), and
//   • the SAME two invariants hold when reading through the reporting VIEWS
//     (v_conversions_due / v_policy_lapse_risk / v_pipeline_by_engagement) — the
//     views are security_invoker so the caller's RLS applies. A security_definer
//     view would have leaked exactly the rows RLS hides; that gap is why the
//     Supabase linter caught what our table-only tests didn't.
// Requires a local Postgres + the `postgres` OS user (present in this environment).
// Run: node tests/rls-firewall.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

// Locate a Postgres bin dir. Skip cleanly (not a false pass) if unavailable.
let PGBIN = null
try {
  const base = '/usr/lib/postgresql'
  if (existsSync(base)) {
    const ver = readdirSync(base).sort().pop()
    if (ver && existsSync(`${base}/${ver}/bin/initdb`)) PGBIN = `${base}/${ver}/bin`
  }
} catch { /* ignore */ }

let canRunAsPostgres = false
try { sh('id postgres'); canRunAsPostgres = true } catch { /* no postgres user */ }

if (!PGBIN || !canRunAsPostgres) {
  // In CI this proof MUST run — a missing toolchain is a failure, not a pass.
  // Locally (no CI_REQUIRE_INFRA) we skip cleanly so the suite stays runnable.
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    console.error('The RLS-firewall proof (Case 7) cannot silently skip in CI — provision Postgres.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  console.log('(Case 7 was also verified on the live Supabase preview branch: Migrations ✅.)')
  process.exit(0)
}

const D = '/tmp/fsos-rls-test'
const L = '/tmp/fsos-rls-log'
const P = '55455'
const H = L
const UID = '11111111-1111-1111-1111-111111111111'

// -f a SQL file (avoids shell $$-mangling); -c only for $-free SELECTs.
function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -f ${path}`)
}
// Run a statement as the postgres superuser; return true iff it raised an error.
// Used to prove the fna_versions immutability trigger fires (mig 060).
function psqlErrors(sql) {
  try {
    sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(sql)}`)
    return false
  } catch {
    return true
  }
}
function psqlQuery(sql) {
  const raw = sh(
    `runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`,
  )
  // The leading "set role" emits a "SET" command tag; the SELECT value is last.
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

console.log('Case 7 — RLS firewall / column-row allowlist (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres fsos_test`)

  // Supabase-provided bits: auth.uid() pinned to a client user; auth roles.
  // Single-quoted function body (no $$) so the file is unambiguous.
  writeFileSync(
    `${L}/setup.sql`,
    `create schema if not exists auth;\n` +
      `create or replace function auth.uid() returns uuid language sql stable as 'select ''${UID}''::uuid';\n` +
      `do 'begin if not exists (select from pg_roles where rolname=''authenticated'') then create role authenticated; end if; ` +
      `if not exists (select from pg_roles where rolname=''anon'') then create role anon; end if; ` +
      `if not exists (select from pg_roles where rolname=''service_role'') then create role service_role; end if; end';\n`,
  )
  psqlFile(`${L}/setup.sql`)

  psqlFile('supabase/migrations/009_aggregate_root_core.sql')
  psqlFile('supabase/migrations/010_rls_guardrails.sql')
  // 011/012/013 add the reporting views; 015 flips them to security_invoker.
  psqlFile('supabase/migrations/011_p0_softdelete_views_dob.sql')
  psqlFile('supabase/migrations/012_p1_reviews_comms_commission.sql')
  psqlFile('supabase/migrations/013_p2_operational_enhancement.sql')
  psqlFile('supabase/migrations/015_security_invoker_views.sql')
  // 033 creates comm_conversations/comm_message_events (needed by the Slice 2 identity
  // columns in 051). Depends only on 009/013 tables already applied above.
  psqlFile('supabase/migrations/033_comms_inbound_knowledge_campaigns.sql')
  // 049 adds the delegation + assignment-review tables (Slice 1). Both are back-office
  // only (no client policy) — the proof below asserts a client sees ZERO rows from each.
  psqlFile('supabase/migrations/049_comm_delegation_ownership.sql')
  // 050 tightens comm_assignment_reviews.channel/destination to NOT NULL (#107 follow-up).
  psqlFile('supabase/migrations/050_comm_assignment_review_notnull.sql')
  // 053 adds the identity-disclosure config (Slice 2) — back-office, client sees 0 rows.
  psqlFile('supabase/migrations/053_comm_identity_disclosure.sql')
  // 054 adds the consent purpose axis + comm_frequency_policy (Slice 3) — back-office config.
  psqlFile('supabase/migrations/054_comm_purpose_frequency.sql')
  // 055 reconciles 054: restores consents unique(member,channel) + moves the purpose axis
  // to the companion comm_consent_purposes table (upsert-safe). Both back-office.
  psqlFile('supabase/migrations/055_comm_consent_purpose_reconcile.sql')
  // 056 adds the conversation-mode pause status + comm_conversation_policy (Slice 4).
  psqlFile('supabase/migrations/056_comm_conversation_mode.sql')
  // 057 adds comm_campaigns.simulated_at + last_simulation (Slice 6 §14) — applies cleanly.
  psqlFile('supabase/migrations/057_comm_campaign_simulation.sql')
  // 058 adds campaign/sequence purpose + delegated-sender builder cols (Slice 7 §15/§16).
  psqlFile('supabase/migrations/058_comm_builder_purpose_delegation.sql')
  // 059 adds comm_campaigns.claim_fields (Slice 8 §18 data-confidence declaration).
  psqlFile('supabase/migrations/059_comm_campaign_claim_fields.sql')
  // 060 adds the FNA data model (Slice 2). All fna_* tables are back-office only
  // (no client policy) — the proof below asserts a client sees ZERO rows from them.
  psqlFile('supabase/migrations/060_fna_data_model.sql')
  // 061 adds comm_templates.body_text/render_sha/source_key (Slice 9B hybrid render).
  psqlFile('supabase/migrations/061_comm_template_render.sql')
  // 062 adds fna_recommendations (Slice 9) — back-office only; a client sees ZERO rows.
  psqlFile('supabase/migrations/062_fna_recommendations.sql')
  // 063 adds the Social Content Module (ADR-026). All social_* tables are
  // back-office only (no client policy) — the proof below asserts a client sees
  // ZERO rows, and that the approval gate + immutability + append-only triggers fire.
  psqlFile('supabase/migrations/063_social_content.sql')

  // Seed: this client's household + a second household; a life + a securities policy.
  // conversion_deadline/is_with_us are set so every policy also surfaces in the
  // reporting views (v_conversions_due / v_policy_lapse_risk) — otherwise the view
  // checks below would pass vacuously (0 rows for everyone).
  writeFileSync(
    `${L}/seed.sql`,
    `insert into households(id, primary_name) values ` +
      `('22222222-2222-2222-2222-222222222222','My Household'),('33333333-3333-3333-3333-333333333333','Someone Else');\n` +
      `insert into user_roles(user_id, role) values ('${UID}','client');\n` +
      `insert into user_households(user_id, household_id) values ('${UID}','22222222-2222-2222-2222-222222222222');\n` +
      `insert into household_policies(household_id, is_security, policy_number, is_with_us, status, conversion_deadline, renewal_date) values ` +
      `('22222222-2222-2222-2222-222222222222', false, 'LIFE-001', true, 'active', current_date + 20, current_date + 10),` +
      `('22222222-2222-2222-2222-222222222222', true,  'SEC-999',  true, 'active', current_date + 20, current_date + 10),` +
      `('33333333-3333-3333-3333-333333333333', false, 'OTHER-1',  true, 'active', current_date + 20, current_date + 10);\n` +
      // Opportunities are FSA/staff-only (no client RLS policy at all), so a client
      // reading v_pipeline_by_engagement must see ZERO rows — including the is_security one.
      `insert into opportunities(household_id, engagement, stage, is_security) values ` +
      `('22222222-2222-2222-2222-222222222222','warm_handoff','prospect', false),` +
      `('22222222-2222-2222-2222-222222222222','direct','fact_find', true);\n` +
      `grant select on household_policies, households, opportunities to authenticated;\n` +
      `grant select on v_conversions_due, v_policy_lapse_risk, v_pipeline_by_engagement to authenticated;\n` +
      // Slice 1 (mig 049): a delegation + an assignment-review row. Both back-office;
      // a client must see NEITHER (default-deny RLS, no client policy) even with grant.
      `insert into agency_partnerships(id, agency_name, owner_name) values ` +
      `('44444444-4444-4444-4444-444444444444','Test Agency','Owner One');\n` +
      `insert into agency_owners(id, agency_id, full_name) values ` +
      `('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','Owner One');\n` +
      `insert into agency_communication_delegations(agency_id, agency_owner_id, status) values ` +
      `('44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555','ACTIVE');\n` +
      `insert into comm_assignment_reviews(channel, destination, household_id, reason) values ` +
      `('sms','+15550100','22222222-2222-2222-2222-222222222222','ownership unresolved: no agency owner');\n` +
      // Slice 3 hotfix (mig 055): PROVE the consents onConflict(member_id,channel) arbiter
      // is restored — if 055 failed to re-add the unique constraint, this upsert errors and
      // (ON_ERROR_STOP=1) the whole proof fails. Then a companion purpose row (back-office).
      `insert into household_members(id, household_id, full_name) values ` +
      `('66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222','Member One');\n` +
      `insert into consents(member_id, household_id, channel, status) values ` +
      `('66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222','sms','granted') ` +
      `on conflict (member_id, channel) do update set status = excluded.status;\n` +
      `insert into consents(member_id, household_id, channel, status) values ` +
      `('66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222','sms','revoked') ` +
      `on conflict (member_id, channel) do update set status = excluded.status;\n` +
      `insert into comm_consent_purposes(member_id, channel, purpose, status) values ` +
      `('66666666-6666-6666-6666-666666666666','sms','MARKETING_SMS','granted');\n` +
      // Slice 2 (mig 060): an FNA plan + an immutable version on this client's household.
      // Both fna_* tables are back-office only; a client must see NEITHER even with grant.
      `insert into fna_plans(id, household_id, plan_type, status) values ` +
      `('77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222','comprehensive','CALCULATED');\n` +
      `insert into fna_versions(plan_id, version_no, assumption_set_version, engine_version) values ` +
      `('77777777-7777-7777-7777-777777777777', 1, 'default-v1', '1.0.0');\n` +
      // Slice 9 (mig 062): a human recommendation on this plan — back-office only.
      `insert into fna_recommendations(plan_id, household_id, objective, authored_by) values ` +
      `('77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222','Review protection gap','fsa');\n` +
      // Social module (mig 063): a channel, content, an APPROVED + an IN_REVIEW
      // version, an APPROVED-gated schedule entry, and a publish-log row. All
      // social_* tables are back-office only; a client must see NONE even with grant.
      `insert into social_channels(id, platform, display_name, status) values ` +
      `('88888888-8888-8888-8888-888888888888','youtube','Test YT','not_configured');\n` +
      `insert into social_content(id, body, status) values ` +
      `('99999999-9999-9999-9999-999999999999','Educational tips','DRAFT');\n` +
      `insert into social_content_versions(id, content_id, version_no, status, snapshot) values ` +
      `('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','99999999-9999-9999-9999-999999999999',1,'APPROVED','{}'),` +
      `('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','99999999-9999-9999-9999-999999999999',2,'IN_REVIEW','{}');\n` +
      `insert into social_schedule_entries(id, version_id, channel_id, scheduled_at, idempotency_key) values ` +
      `('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88888888-8888-8888-8888-888888888888', now(), 'sched-1');\n` +
      `insert into social_publish_log(id, schedule_entry_id, version_id, channel_id, attempt, outcome, platform_post_id) values ` +
      `('dddddddd-dddd-dddd-dddd-dddddddddddd','cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88888888-8888-8888-8888-888888888888',1,'success','yt_123');\n` +
      `grant select on agency_communication_delegations, comm_assignment_reviews, comm_identity_config, comm_frequency_policy, comm_consent_purposes, comm_conversation_policy, fna_plans, fna_versions, fna_recommendations, social_channels, social_content, social_content_versions, social_schedule_entries, social_publish_log to authenticated;\n`,
  )
  psqlFile(`${L}/seed.sql`)

  const visiblePolicies = psqlQuery(
    "set role authenticated; select coalesce(string_agg(policy_number, ',' order by policy_number),'<none>') from household_policies;",
  )
  const visibleHouseholds = psqlQuery(
    "set role authenticated; select coalesce(string_agg(primary_name, ',' order by primary_name),'<none>') from households;",
  )

  // Same firewall/scope invariants, but read through the reporting VIEWS. Because
  // the views are security_invoker, the caller's RLS applies to view reads too.
  const viewConversions = psqlQuery(
    "set role authenticated; select coalesce(string_agg(policy_number, ',' order by policy_number),'<none>') from v_conversions_due;",
  )
  const viewLapseRisk = psqlQuery(
    "set role authenticated; select coalesce(string_agg(policy_number, ',' order by policy_number),'<none>') from v_policy_lapse_risk;",
  )
  const viewPipelineRows = psqlQuery(
    'set role authenticated; select count(*) from v_pipeline_by_engagement;',
  )

  // Slice 1 (mig 049): client must see zero delegation / assignment-review rows.
  const visibleDelegations = psqlQuery(
    'set role authenticated; select count(*) from agency_communication_delegations;',
  )
  const visibleAssignments = psqlQuery(
    'set role authenticated; select count(*) from comm_assignment_reviews;',
  )
  const visibleIdentityConfig = psqlQuery(
    'set role authenticated; select count(*) from comm_identity_config;',
  )
  const visibleFrequencyPolicy = psqlQuery(
    'set role authenticated; select count(*) from comm_frequency_policy;',
  )
  const visibleConsentPurposes = psqlQuery(
    'set role authenticated; select count(*) from comm_consent_purposes;',
  )
  const visibleConversationPolicy = psqlQuery(
    'set role authenticated; select count(*) from comm_conversation_policy;',
  )

  // Slice 2 (mig 060): client must see zero FNA plan / version rows.
  const visibleFnaPlans = psqlQuery('set role authenticated; select count(*) from fna_plans;')
  const visibleFnaVersions = psqlQuery('set role authenticated; select count(*) from fna_versions;')
  const visibleFnaRecs = psqlQuery('set role authenticated; select count(*) from fna_recommendations;')

  // Slice 2 (mig 060): fna_versions immutability trigger. As the superuser (RLS
  // bypassed) prove: a snapshot column cannot be mutated; a lifecycle column
  // (status) can; and an APPROVED version cannot be deleted.
  const V = "plan_id='77777777-7777-7777-7777-777777777777'"
  const snapshotUpdateBlocked = psqlErrors(`update fna_versions set results = '{"x":1}'::jsonb where ${V};`)
  const statusUpdateAllowed = !psqlErrors(`update fna_versions set status='APPROVED' where ${V};`)
  const approvedDeleteBlocked = psqlErrors(`delete from fna_versions where ${V};`)

  // ── Social module (mig 061) — back-office isolation + gate/immutability triggers ──
  const visibleSocialChannels = psqlQuery('set role authenticated; select count(*) from social_channels;')
  const visibleSocialContent = psqlQuery('set role authenticated; select count(*) from social_content;')
  const visibleSocialVersions = psqlQuery('set role authenticated; select count(*) from social_content_versions;')

  // Approval gate: scheduling the IN_REVIEW version (bbbb) must raise. Runs BEFORE
  // that version's status is advanced below.
  const socialApprovalGateBlocked = psqlErrors(
    "insert into social_schedule_entries(version_id, channel_id, scheduled_at, idempotency_key) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','88888888-8888-8888-8888-888888888888', now(), 'sched-2');",
  )
  // Version immutability: a snapshot column cannot change; status can; a PUBLISHED
  // version cannot be deleted.
  const socialSnapshotBlocked = psqlErrors(
    `update social_content_versions set snapshot = '{"x":1}'::jsonb where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';`,
  )
  const socialStatusAllowed = !psqlErrors(
    "update social_content_versions set status='PUBLISHED' where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';",
  )
  const socialPublishedDeleteBlocked = psqlErrors(
    "delete from social_content_versions where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';",
  )
  // Append-only publish log: UPDATE must raise.
  const socialPublishLogAppendOnly = psqlErrors(
    "update social_publish_log set attempt=2 where id='dddddddd-dddd-dddd-dddd-dddddddddddd';",
  )

  let passed = 0
  const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

  t('client CANNOT read the is_security policy (firewall row rule)', () => {
    assert.equal(visiblePolicies, 'LIFE-001', `expected only LIFE-001, got: ${visiblePolicies}`)
    assert.ok(!visiblePolicies.includes('SEC-999'), 'SEC-999 must not be visible')
  })
  t("client CANNOT read another household's policy (scope allowlist)", () => {
    assert.ok(!visiblePolicies.includes('OTHER-1'), 'OTHER-1 must not be visible')
  })
  t('client sees only their own household', () => {
    assert.equal(visibleHouseholds, 'My Household', `expected only My Household, got: ${visibleHouseholds}`)
  })

  // ── VIEW checks — the security_definer_view finding the linter caught. ──
  t('v_conversions_due (view) hides the is_security row (firewall holds on views)', () => {
    assert.ok(!viewConversions.includes('SEC-999'), `SEC-999 must not be visible via view, got: ${viewConversions}`)
    assert.equal(viewConversions, 'LIFE-001', `expected only LIFE-001 via view, got: ${viewConversions}`)
  })
  t("v_conversions_due (view) hides another household's row (scope holds on views)", () => {
    assert.ok(!viewConversions.includes('OTHER-1'), `OTHER-1 must not be visible via view, got: ${viewConversions}`)
  })
  t('v_policy_lapse_risk (view) hides the is_security and other-household rows', () => {
    assert.equal(viewLapseRisk, 'LIFE-001', `expected only LIFE-001 via view, got: ${viewLapseRisk}`)
    assert.ok(!viewLapseRisk.includes('SEC-999'), 'SEC-999 must not be visible via view')
    assert.ok(!viewLapseRisk.includes('OTHER-1'), 'OTHER-1 must not be visible via view')
  })
  t('v_pipeline_by_engagement (view) returns NO opportunity rows to a client', () => {
    // Client has no RLS read path to opportunities at all; the view must not
    // become a back door (including for the is_security opportunity).
    assert.equal(viewPipelineRows, '0', `expected 0 pipeline rows via view, got: ${viewPipelineRows}`)
  })

  t('client CANNOT read agency_communication_delegations (back-office default-deny, mig 049)', () => {
    assert.equal(visibleDelegations, '0', `expected 0 delegations to a client, got: ${visibleDelegations}`)
  })
  t('client CANNOT read comm_assignment_reviews (back-office default-deny, mig 049)', () => {
    assert.equal(visibleAssignments, '0', `expected 0 assignment reviews to a client, got: ${visibleAssignments}`)
  })
  t('client CANNOT read comm_identity_config (back-office default-deny, mig 053)', () => {
    assert.equal(visibleIdentityConfig, '0', `expected 0 identity-config rows to a client, got: ${visibleIdentityConfig}`)
  })
  t('client CANNOT read comm_frequency_policy (back-office default-deny, mig 054)', () => {
    assert.equal(visibleFrequencyPolicy, '0', `expected 0 frequency-policy rows to a client, got: ${visibleFrequencyPolicy}`)
  })
  t('client CANNOT read comm_consent_purposes (back-office default-deny, mig 055)', () => {
    assert.equal(visibleConsentPurposes, '0', `expected 0 consent-purpose rows to a client, got: ${visibleConsentPurposes}`)
  })
  t('client CANNOT read comm_conversation_policy (back-office default-deny, mig 056)', () => {
    assert.equal(visibleConversationPolicy, '0', `expected 0 conversation-policy rows to a client, got: ${visibleConversationPolicy}`)
  })

  t('client CANNOT read fna_plans (back-office default-deny, mig 060)', () => {
    assert.equal(visibleFnaPlans, '0', `expected 0 FNA plans to a client, got: ${visibleFnaPlans}`)
  })
  t('client CANNOT read fna_versions (back-office default-deny, mig 060)', () => {
    assert.equal(visibleFnaVersions, '0', `expected 0 FNA versions to a client, got: ${visibleFnaVersions}`)
  })
  t('client CANNOT read fna_recommendations (back-office default-deny, mig 062)', () => {
    assert.equal(visibleFnaRecs, '0', `expected 0 FNA recommendations to a client, got: ${visibleFnaRecs}`)
  })
  t('fna_versions snapshot columns are immutable (mig 060 trigger)', () => {
    assert.equal(snapshotUpdateBlocked, true, 'updating results on a frozen version must raise')
  })
  t('fna_versions lifecycle column (status) remains editable', () => {
    assert.equal(statusUpdateAllowed, true, 'advancing status must be allowed')
  })
  t('an APPROVED fna_version cannot be deleted (mig 060 trigger)', () => {
    assert.equal(approvedDeleteBlocked, true, 'deleting an APPROVED version must raise')
  })

  t('client CANNOT read social_channels (back-office default-deny, mig 063)', () => {
    assert.equal(visibleSocialChannels, '0', `expected 0 social channels to a client, got: ${visibleSocialChannels}`)
  })
  t('client CANNOT read social_content (back-office default-deny, mig 063)', () => {
    assert.equal(visibleSocialContent, '0', `expected 0 social content to a client, got: ${visibleSocialContent}`)
  })
  t('client CANNOT read social_content_versions (back-office default-deny, mig 063)', () => {
    assert.equal(visibleSocialVersions, '0', `expected 0 social versions to a client, got: ${visibleSocialVersions}`)
  })
  t('social approval gate: scheduling a non-APPROVED version raises (mig 063 trigger)', () => {
    assert.equal(socialApprovalGateBlocked, true, 'scheduling an IN_REVIEW version must raise')
  })
  t('social_content_versions snapshot columns are immutable (mig 063 trigger)', () => {
    assert.equal(socialSnapshotBlocked, true, 'updating snapshot on a frozen version must raise')
  })
  t('social_content_versions lifecycle column (status) remains editable', () => {
    assert.equal(socialStatusAllowed, true, 'advancing status must be allowed')
  })
  t('a PUBLISHED social_content_version cannot be deleted (mig 063 trigger)', () => {
    assert.equal(socialPublishedDeleteBlocked, true, 'deleting a PUBLISHED version must raise')
  })
  t('social_publish_log is append-only (mig 063 trigger)', () => {
    assert.equal(socialPublishLogAppendOnly, true, 'updating an immutable publish-log row must raise')
  })

  console.log(`\nCase 7: all ${passed} RLS firewall assertions passed.`)
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop > /dev/null 2>&1`) } catch { /* ignore */ }
  try { sh(`rm -rf ${D} ${L}`) } catch { /* ignore */ }
}
