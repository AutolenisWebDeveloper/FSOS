// tests/comms-inbound-e2e.test.mjs
// END-TO-END PROOF of the inbound two-way SMS loop against a REAL Postgres.
//
//   api/webhooks/twilio/inbound → processInbound() → tryAutoReply() → draftReply()
//   → sendThroughGate() → dispatcher → evaluateGate()
//
// Everything below runs the PRODUCTION modules (src/lib/comms/*, src/lib/ai/responder.ts)
// bundled by esbuild, against an ephemeral Postgres with ALL 104 migrations applied.
// Rows are asserted with raw SQL, not with mock call-counts.
//
// WHAT IS REAL: the schema, every constraint/unique index/trigger, conversation
// threading + member→household→agency association, comm_messages, consents,
// dnc_entries, comm_campaign_enrollments, agent_actions, audit_log, the 7-step gate,
// the AI authority matrix + §12 evaluations, the A2P backstop, quiet/business hours,
// personalization and the audit writer.
//
// WHAT IS STUBBED (the two external network boundaries only, at globalThis.fetch —
// the FSOS code that calls them still executes for real):
//   • api.anthropic.com  → a canned green-zone assistant reply (no model access here)
//   • api.twilio.com     → a canned message SID (no real SMS is ever placed)
// Every prompt sent toward Anthropic is captured so the transcript assertion checks the
// ACTUAL prompt the responder built.
//
// Run: node tests/comms-inbound-e2e.test.mjs   (needs local Postgres + the postgres user)
import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { makeShim } from './helpers/postgrest-shim.mjs'
import { buildInboundBundle } from './helpers/build-inbound-bundle.mjs'

// ─── environment guard (skip cleanly, fail loudly in CI) ────────────────────────
let PGBIN = null
try {
  const base = '/usr/lib/postgresql'
  if (existsSync(base)) {
    const ver = readdirSync(base).sort().pop()
    if (ver && existsSync(`${base}/${ver}/bin/initdb`)) PGBIN = `${base}/${ver}/bin`
  }
} catch { /* ignore */ }
let canRunAsPostgres = false
try { execSync('id postgres', { stdio: 'pipe' }); canRunAsPostgres = true } catch { /* none */ }

if (!PGBIN || !canRunAsPostgres) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  process.exit(0)
}

const D = '/tmp/fsos-inbound-e2e-data'
const L = '/tmp/fsos-inbound-e2e-log'
const SQLDIR = '/tmp/fsos-inbound-e2e-sql'
const P = '55488'
const BASE = 'fsos_base'

function sh(cmd) { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }
function psql(dbName, args) {
  return execFileSync('runuser', ['-u', 'postgres', '--', 'psql', '-h', L, '-p', P, '-U', 'postgres',
    '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-t', '-A', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}
function q(dbName, sql) { return psql(dbName, ['-c', sql]).trim() }

// ─── harness SQL: Supabase-managed pieces this container cannot install ─────────
// pg_cron / Storage / the auth schema are provided by Supabase in production. They are
// stand-ins so the migration chain applies; NONE of them is under test here.
const BOOTSTRAP = `
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
create or replace function auth.role() returns text language sql stable as 'select ''service_role''::text';
create or replace function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';
do 'begin
 if not exists (select from pg_roles where rolname=''authenticated'') then create role authenticated; end if;
 if not exists (select from pg_roles where rolname=''anon'') then create role anon; end if;
 if not exists (select from pg_roles where rolname=''service_role'') then create role service_role; end if;
end';
create schema if not exists cron;
create or replace function cron.schedule(text, text, text) returns bigint language sql as 'select 1::bigint';
create or replace function cron.unschedule(text) returns boolean language sql as 'select true';
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null,
  public boolean not null default false, created_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb,
  created_at timestamptz default now());
create or replace function storage.foldername(text) returns text[] language sql immutable
  as 'select string_to_array($1, ''/'')';
`

// ─── results ────────────────────────────────────────────────────────────────────
const results = []
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) }
}
function section(t) { console.log(`\n${t}`) }

// ─── clock control ──────────────────────────────────────────────────────────────
// The gate reads the wall clock for quiet hours (recipient-local 9–20) and hours of
// operation. Freezing "now" makes the proof deterministic; the gate's real predicates
// still run against it — nothing is bypassed.
const RealDate = Date
function freezeClock(iso) {
  const fixed = new RealDate(iso).getTime()
  class FrozenDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(fixed); else super(...a) }
    static now() { return fixed }
  }
  globalThis.Date = FrozenDate
}
// 2026-08-06 is a Thursday. 19:00Z → 13:00 US-Central (UTC-6): inside the TCPA quiet-hours
// floor (9–20) AND inside the seeded hours-of-operation window (9–19, Mon–Sat).
const IN_HOURS = '2026-08-06T19:00:00.000Z'

// ─── external-boundary interception ─────────────────────────────────────────────
const aiCalls = []
const twilioCalls = []
let aiReply = 'Happy to help! Would you like me to set up a time for Markist to walk you through your options?'
function installFetchStub() {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url && url.url ? url.url : url)
    if (u.includes('api.anthropic.com')) {
      let body = {}
      try { body = JSON.parse(init.body ?? '{}') } catch { /* keep {} */ }
      aiCalls.push(body)
      return new Response(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: body.model ?? 'claude-opus-5',
        content: [{ type: 'text', text: aiReply }], stop_reason: 'end_turn',
        usage: { input_tokens: 120, output_tokens: 40 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('api.twilio.com')) {
      twilioCalls.push({ url: u, body: String(init.body ?? '') })
      return new Response(JSON.stringify({ sid: `SM${twilioCalls.length}`.padEnd(34, '0') }),
        { status: 201, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`test harness: unexpected outbound fetch to ${u}`)
  }
}

// ─── per-scenario database ──────────────────────────────────────────────────────
let dbSeq = 0
const IDS = {
  agency: '11111111-1111-1111-1111-111111111111',
  household: '22222222-2222-2222-2222-222222222222',
  member: '33333333-3333-3333-3333-333333333333',
  campaign: '44444444-4444-4444-4444-444444444444',
  enrollment: '55555555-5555-5555-5555-555555555555',
}
const PHONE = '+12145550188'

/** Fresh DB cloned from the migrated template + the standard contact fixture. */
function freshDb(opts = {}) {
  const name = `fsos_t${++dbSeq}`
  q('postgres', `drop database if exists ${name}`)
  q('postgres', `create database ${name} template ${BASE}`)
  const seed = `
    insert into agency_partnerships (id, agency_name, owner_name)
      values ('${IDS.agency}', 'McKinney Agency', 'Dana Owner');
    insert into households (id, primary_name, referring_agency_id)
      values ('${IDS.household}', 'Rivera Household', '${IDS.agency}');
    insert into household_members (id, household_id, full_name, phone, email)
      values ('${IDS.member}', '${IDS.household}', 'Alex Rivera', '${PHONE}', 'alex@example.com');
    insert into consents (member_id, household_id, channel, status, source)
      values ('${IDS.member}', '${IDS.household}', 'sms', 'granted', 'test_seed');
    insert into comm_campaigns (id, name, channel, type, status)
      values ('${IDS.campaign}', 'Test Drip', 'sms', 'drip', 'active');
    insert into comm_campaign_enrollments (id, campaign_id, household_id, member_id, status)
      values ('${IDS.enrollment}', '${IDS.campaign}', '${IDS.household}', '${IDS.member}', 'enrolled');
    ${opts.securities ? `insert into household_policies (household_id, status, is_security)
      values ('${IDS.household}', 'active', true);` : ''}
    ${opts.armed ? `insert into comm_conversations (channel, contact, status, ai_autoreply)
      values ('sms', '${PHONE}', 'open', true);` : ''}
  `
  writeFileSync(`${SQLDIR}/seed.sql`, seed)
  sh(`chmod 644 ${SQLDIR}/seed.sql`)
  psql(name, ['-q', '-f', `${SQLDIR}/seed.sql`])
  globalThis.__FSOS_DB__ = makeShim({ host: L, port: P, db: name })
  return name
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('Inbound two-way SMS loop — END-TO-END on a real Postgres')
let exitCode = 0
try {
  // 1. Ephemeral cluster + full migration chain into the template DB.
  sh(`rm -rf ${D} ${L} ${SQLDIR}`)
  mkdirSync(D, { recursive: true }); mkdirSync(L, { recursive: true }); mkdirSync(SQLDIR, { recursive: true })
  sh(`chown postgres:postgres ${D} ${L}`)
  sh(`chmod 755 ${SQLDIR}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres ${BASE}`)

  writeFileSync(`${SQLDIR}/bootstrap.sql`, BOOTSTRAP)
  sh(`chmod 644 ${SQLDIR}/bootstrap.sql`)
  psql(BASE, ['-q', '-f', `${SQLDIR}/bootstrap.sql`])

  // Migrations are applied VERBATIM except for the single pg_cron `create extension`
  // line, which cannot resolve in this container (cron.schedule is shimmed above).
  const migDir = `${SQLDIR}/mig`
  mkdirSync(migDir, { recursive: true })
  const migFiles = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  for (const f of migFiles) {
    const src = readFileSync(`supabase/migrations/${f}`, 'utf8')
    writeFileSync(`${migDir}/${f}`, src.replace(/^create extension if not exists "pg_cron";$/im,
      '-- [test harness] pg_cron unavailable in this container; cron.schedule is shimmed'))
  }
  sh(`chmod -R 755 ${migDir}`)
  for (const f of migFiles) psql(BASE, ['-q', '-f', `${migDir}/${f}`])
  console.log(`  applied ${migFiles.length} migrations into ${BASE}`)

  // 2. Bundle the real code path.
  const bundlePath = await buildInboundBundle()
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-harness'
  process.env.TWILIO_ACCOUNT_SID = 'ACtestharness'
  process.env.TWILIO_AUTH_TOKEN = 'test-token'
  process.env.TWILIO_PHONE_NUMBER = '+12145550100'
  process.env.SMS_A2P_APPROVED = 'true' // A2P go-live: proven separately below
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test'
  delete process.env.AI_GATEWAY_DISABLED
  installFetchStub()
  freezeClock(IN_HOURS)
  const require = createRequire(import.meta.url)
  const { processInbound, sendThroughGate, exitWinback, exitLife, exitXsell } = require(bundlePath)

  // ── SCENARIO 1: threading, association, inbound row, and the auto-reply attempt ──
  section('1. Inbound message → thread, association, history, auto-reply attempt')
  {
    // Thread pre-armed the way /api/comms/conversations/start and the campaign tick do
    // (ai_autoreply=true) but with NO associations, so member→household→agency backfill
    // is still proven by this run.
    const db = freshDb({ armed: true })
    aiCalls.length = 0; twilioCalls.length = 0
    const r = await processInbound({
      channel: 'sms', from: PHONE, body: 'What is term life insurance?',
      provider: 'twilio', providerId: 'SM_real_1',
    })

    check('a conversation thread is created for (sms, contact)', () => {
      assert.equal(q(db, `select count(*) from comm_conversations where channel='sms' and contact='${PHONE}'`), '1')
    })
    check('thread is auto-associated to member → household → agency', () => {
      const row = q(db, `select member_id||'|'||household_id||'|'||agency_id from comm_conversations where contact='${PHONE}'`)
      assert.equal(row, `${IDS.member}|${IDS.household}|${IDS.agency}`)
    })
    check('the inbound comm_messages row is recorded with full association', () => {
      const row = q(db, `select direction||'|'||delivery_status||'|'||sender||'|'||member_id||'|'||household_id||'|'||agency_id||'|'||provider_id
        from comm_messages where provider_id='SM_real_1'`)
      assert.equal(row, `inbound|received|${PHONE}|${IDS.member}|${IDS.household}|${IDS.agency}|SM_real_1`)
    })
    check('a "replied" message event is recorded for the inbound turn', () => {
      const n = q(db, `select count(*) from comm_message_events where event='replied' and conversation_id=(select id from comm_conversations where contact='${PHONE}')`)
      assert.ok(Number(n) >= 1, `expected >=1 replied events, got ${n}`)
    })
    check('the model WAS called — draftReply actually ran (not short-circuited)', () => {
      assert.equal(aiCalls.length, 1, `expected exactly 1 model call, got ${aiCalls.length}`)
    })
    check('an agent_runs row records the drafting run with model + tokens + cost', () => {
      const row = q(db, `select status||'|'||agent_key||'|'||coalesce(model,'-')||'|'||input_tokens||'|'||output_tokens from agent_runs order by started_at desc limit 1`)
      assert.match(row, /^completed\|conversation\|/, `agent_runs row was ${row}`)
      assert.match(row, /\|120\|40$/, `token usage not recorded: ${row}`)
    })

    // The outcome of the SEND is reported exactly as the code produces it — this is the
    // assertion that must never be written to match a convenient answer.
    const outbound = q(db, `select coalesce(delivery_status,'-')||'|'||coalesce(blocked_step,'-')||'|'||coalesce(block_reason,'-')
      from comm_messages where direction='outbound' order by created_at desc limit 1`)
    console.log(`    → outbound row: ${outbound || '(none)'}`)
    console.log(`    → processInbound result: ${JSON.stringify(r)}`)
    console.log(`    → twilio HTTP calls: ${twilioCalls.length}`)

    check('an outbound AI reply row is created and threaded', () => {
      assert.equal(q(db, `select count(*) from comm_messages where direction='outbound' and ai_generated=true`), '1')
    })
    check('AUTO-REPLY SENDS — a classified green-zone reply clears the gate and dispatches', () => {
      assert.equal(r.autoReplied, true,
        `autoReplied=false; outbound row was "${outbound}"; escalated=${r.escalated}`)
      assert.equal(r.escalated, false)
      assert.equal(outbound, 'sent|-|-', `unexpected outbound outcome: ${outbound}`)
      assert.equal(twilioCalls.length, 1, 'no SMS was placed with the provider')
    })
    // The dispatcher appends SMS_OPT_OUT_FOOTER ('Reply STOP to opt out.') and NOTHING else.
    // The former "This message was generated by an AI assistant." sentence was removed at the
    // FSA's direction on 2026-08-06 (commit 352db63 / PR #269; CLAUDE.md §12 records the
    // decision and the reasoning: TRAIGA HB 149's mandate reaches government and healthcare
    // interactions, not a private agency's outreach, and the sentence cost ~47 chars of segment
    // budget per send). AI self-identification is UNCHANGED and still ships — it lives in the
    // copy of every AI playbook opener, asserted per campaign by
    // tests/lifecycle-campaign-messaging.test.mjs. This check guards both halves: the carrier-
    // required opt-out must stay, and the retired disclosure sentence must not creep back in.
    check('the dispatched reply carries the opt-out footer and NOT the retired AI-disclosure sentence', () => {
      const body = q(db, `select body from comm_messages where direction='outbound' order by created_at desc limit 1`)
      assert.match(body, /STOP to opt out/i, `opt-out instruction absent from the stored sent body: ${body}`)
      assert.doesNotMatch(
        body,
        /generated by an AI assistant/i,
        `the retired TRAIGA disclosure sentence reappeared in the sent body — see CLAUDE.md §12, ` +
          `it may not be reintroduced without the FSA's direction: ${body}`,
      )
    })
    check('the send is recorded with its classified class + purpose (auditable)', () => {
      assert.equal(q(db, `select purpose||'|'||ai_generated||'|'||coalesce(consent_at_send::text,'-') from comm_messages where direction='outbound' order by created_at desc limit 1`),
        'SERVICING|true|true')
    })
    check('no FSA escalation is raised for a reply that sent', () => {
      assert.equal(q(db, `select count(*) from agent_actions where kind='escalation'`), '0')
    })
  }

  // ── SCENARIO 1b: the classifier's fail-closed half, end to end ────────────────
  section('1b. A regulated topic is held for the FSA, not auto-sent')
  {
    // Same armed thread, same consent, same clock — the ONLY difference from scenario 1 is
    // what the contact asked. This isolates the classifier as the deciding factor.
    const cases = [
      ['pricing', 'What would my premium be for $500k?', 'pricing_premium', /pricing or premium/],
      ['securities', 'Can you take a look at my 401k rollover?', 'securities_related', /securities/],
      ["the contact's own policy", 'Can you check the death benefit on my policy?', 'policy_specific_explanation', /own policy/],
      ['advice request', 'What do you recommend I do?', 'financial_recommendation', /advice or a recommendation/],
    ]
    let i = 0
    for (const [label, inbound, , reasonRe] of cases) {
      const dbH = freshDb({ armed: true })
      twilioCalls.length = 0
      const rh = await processInbound({ channel: 'sms', from: PHONE, body: inbound, provider: 'twilio', providerId: `SM_hold_${i++}` })
      const row = q(dbH, `select coalesce(delivery_status,'-')||'|'||coalesce(blocked_step,'-') from comm_messages where direction='outbound' order by created_at desc limit 1`)
      const note = q(dbH, `select coalesce(note,'-') from agent_actions where kind='escalation' order by created_at desc limit 1`)
      console.log(`    → ${label}: sent=${rh.autoReplied} row=${row}`)
      check(`HOLD — "${label}" is never auto-sent`, () => {
        assert.equal(rh.autoReplied, false, `a ${label} reply was auto-sent`)
        assert.equal(rh.escalated, true)
        assert.equal(twilioCalls.length, 0, 'an SMS was placed on a held reply')
        assert.equal(row, 'blocked|ai_authority', `unexpected outcome: ${row}`)
      })
      check(`HOLD — "${label}" escalation explains WHY (not just a gate step)`, () => {
        assert.match(note, reasonRe, `escalation note was: ${note}`)
      })
      check(`HOLD — "${label}" preserves the drafted text for the FSA`, () => {
        assert.ok(Number(q(dbH, `select count(*) from agent_actions where kind='ai_draft' and drafted_content is not null`)) >= 1,
          'the drafted reply was not preserved')
      })
      check(`HOLD — "${label}" persists delivery_status=blocked, not a generic failure`, () => {
        // events.ts records a `failed` LEDGER event alongside every hold, and its lifecycle
        // patch used to overwrite delivery_status='blocked' with 'failed' — so a compliance
        // hold rendered as "Failed" on every comms surface while blocked_step still said why
        // it was blocked. The status vocabulary was right; the data under it was clobbered.
        assert.match(row, /^blocked\|/, `the block was downgraded to a delivery failure: ${row}`)
      })
      check(`HOLD — "${label}" still records the failed event in the append-only ledger`, () => {
        assert.ok(Number(q(dbH, `select count(*) from comm_message_events where event='failed'`)) >= 1,
          'protecting the parent status must not suppress the ledger row')
      })
    }
  }

  // ── SCENARIO 1b2: a human moment gets a person, not a scheduling invitation ────
  section('1b2. Bereavement / hardship / complaint → silence + urgent escalation')
  {
    const cases = [
      ['bereavement', 'My husband passed away, does our policy pay out?'],
      ['hardship', 'I lost my job and cant make the payment this month'],
      ['complaint', 'this is unacceptable, nobody has called me back'],
    ]
    let i = 0
    for (const [label, inbound] of cases) {
      const dbU = freshDb({ armed: true })
      twilioCalls.length = 0
      const ru = await processInbound({ channel: 'sms', from: PHONE, body: inbound, provider: 'twilio', providerId: `SM_human_${i++}` })
      const esc = q(dbU, `select reason||'|'||coalesce(note,'-') from agent_actions where kind='escalation' order by created_at desc limit 1`)
      console.log(`    → ${label}: sent=${ru.autoReplied} | ${esc}`)
      check(`HUMAN MOMENT — "${label}" sends nothing to the contact`, () => {
        assert.equal(ru.autoReplied, false, 'the automation replied to a human moment')
        assert.equal(twilioCalls.length, 0, 'an SMS went out on a human moment')
      })
      check(`HUMAN MOMENT — "${label}" escalates under the URGENT reason, not the generic one`, () => {
        assert.match(esc, /^urgent_human_attention\|/,
          `expected urgent_human_attention so it is findable ahead of routine holds: ${esc}`)
        assert.equal(ru.escalated, true)
      })
      check(`HUMAN MOMENT — "${label}" is auditable`, () => {
        assert.ok(Number(q(dbU, `select count(*) from audit_log where action='ai.escalated' and diff::text like '%urgent_human_attention%'`)) >= 1)
      })
    }
    // The urgent reason must stay distinguishable from a routine content hold, or it is
    // filterable in name only.
    const dbR2 = freshDb({ armed: true })
    await processInbound({ channel: 'sms', from: PHONE, body: 'What would my premium be?', provider: 'twilio', providerId: 'SM_routine_hold' })
    check('a ROUTINE hold keeps the generic gate reason (the urgent flag stays meaningful)', () => {
      const esc = q(dbR2, `select reason from agent_actions where kind='escalation' order by created_at desc limit 1`)
      assert.equal(esc, 'gate_blocked:ai_authority', `routine hold used: ${esc}`)
      assert.equal(q(dbR2, `select count(*) from agent_actions where reason='urgent_human_attention'`), '0')
    })
  }

  // ── SCENARIO 1b3: the per-agent kill switch on the threads it names ───────────
  section('1b3. A campaign-armed thread is governed by ITS agent, not the responder')
  {
    // A pipeline-armed thread: the campaign ticks set agent_key when they arm a thread after
    // a delivered AI opener (campaign-ai.ts). Gate step 4 must consult THAT agent.
    const dbA = freshDb({ armed: true })
    q(dbA, `update comm_conversations set agent_key='pipeline' where contact='${PHONE}'`)
    twilioCalls.length = 0
    const ok = await processInbound({ channel: 'sms', from: PHONE, body: 'What is term life insurance?', provider: 'twilio', providerId: 'SM_agent_ok' })
    check('a pipeline-armed thread still replies while the pipeline agent is enabled', () => {
      assert.equal(ok.autoReplied, true, 'the reply was blocked with the agent enabled')
      assert.equal(twilioCalls.length, 1)
    })
    check('the send is attributed to the OWNING agent, not the conversation responder', () => {
      assert.equal(q(dbA, `select actor from comm_messages where direction='outbound' order by created_at desc limit 1`),
        'agent:pipeline')
    })

    // Disable the pipeline agent. Its own threads must stop.
    const dbB = freshDb({ armed: true })
    q(dbB, `update comm_conversations set agent_key='pipeline' where contact='${PHONE}'`)
    q(dbB, `update ai_agents set enabled=false where key='pipeline'`)
    twilioCalls.length = 0
    const killed = await processInbound({ channel: 'sms', from: PHONE, body: 'What is term life insurance?', provider: 'twilio', providerId: 'SM_agent_kill' })
    const row = q(dbB, `select coalesce(delivery_status,'-')||'|'||coalesce(blocked_step,'-')||'|'||coalesce(block_reason,'-') from comm_messages where direction='outbound' order by created_at desc limit 1`)
    console.log(`    → pipeline agent disabled: sent=${killed.autoReplied} row=${row}`)
    check('disabling the PIPELINE agent stops replies on pipeline threads', () => {
      assert.equal(killed.autoReplied, false,
        'the kill switch named a thread it could not stop — the reply still went out')
      assert.equal(twilioCalls.length, 0)
      // Caught at the AI-authority layer rather than gate step 4: hasApprovedAiPolicy(agentKey)
      // feeds evaluateOutboundMessage as `templateApproved`, and that evaluation runs BEFORE
      // dispatch. Same switch, one layer earlier — the reason names the policy failure.
      assert.equal(row, 'blocked|ai_authority|template_or_policy_not_approved',
        `unexpected block: ${row}`)
    })
    check('the conversation responder being ENABLED does not rescue a disabled owner', () => {
      assert.equal(q(dbB, `select enabled from ai_agents where key='conversation'`), 't',
        'precondition: the responder is still enabled')
    })
    check('the escalation is attributed to the owning agent too', () => {
      assert.equal(q(dbB, `select actor from agent_actions where kind='escalation' order by created_at desc limit 1`),
        'agent:pipeline')
    })

    // The converse: an inbound-initiated thread has no agent_key and must still work off the
    // conversation responder's switch.
    const dbC3 = freshDb({ armed: true })
    q(dbC3, `update ai_agents set enabled=false where key='pipeline'`)
    twilioCalls.length = 0
    const unbound = await processInbound({ channel: 'sms', from: PHONE, body: 'What is term life insurance?', provider: 'twilio', providerId: 'SM_agent_unbound' })
    check('an UNBOUND thread is unaffected by another agent being disabled', () => {
      assert.equal(q(dbC3, `select coalesce(agent_key,'-') from comm_conversations where contact='${PHONE}'`), '-')
      assert.equal(unbound.autoReplied, true, 'a disabled pipeline agent blocked an unbound thread')
      assert.equal(q(dbC3, `select actor from comm_messages where direction='outbound' order by created_at desc limit 1`),
        'agent:conversation')
    })
  }

  // ── SCENARIO 1c: reply-scoped frequency caps (ADR-017 amendment, migration 103) ──
  // Supplying the purpose §12 requires also enrolled replies in the §9 caps, whose seeded
  // 60-minute minimum interval stalled a back-and-forth after ONE turn. Migration 102 adds a
  // second cap row scoped to replies. These checks prove the reply row is what governs, that
  // it is still a real ceiling, and that the drip caps are untouched.
  section('1c. Reply-scoped frequency caps')
  {
    const dbF = freshDb({ armed: true })
    const capRows = q(dbF, `select string_agg(id||':int='||min_interval_minutes||',sms='||max_sms_per_day||',assumption='||is_assumption, ' | ' order by id) from comm_frequency_policy`)
    console.log(`    → cap rows: ${capRows}`)
    check('migration 103 seeds a SECOND cap row scoped to replies', () => {
      assert.equal(q(dbF, `select count(*) from comm_frequency_policy where id='reply'`), '1')
    })
    check('the reply row drops the interval but KEEPS a real per-day ceiling', () => {
      const r = q(dbF, `select min_interval_minutes||'|'||max_sms_per_day||'|'||enabled from comm_frequency_policy where id='reply'`)
      assert.equal(r.split('|')[0], '0', 'the reply interval must be 0')
      assert.ok(Number(r.split('|')[1]) > 0, 'the reply row must keep a per-day ceiling')
      assert.equal(r.split('|')[2], 'true', 'the reply caps must be enabled')
    })
    check('the reply row is a labelled config default (§4.3 gold "verify" badge)', () => {
      assert.equal(q(dbF, `select is_assumption from comm_frequency_policy where id='reply'`), 't')
    })
    check('the OUTREACH row is untouched — drips keep their 60-minute spacing', () => {
      assert.equal(q(dbF, `select min_interval_minutes||'|'||max_sms_per_day from comm_frequency_policy where id='global'`), '60|2')
    })

    // Three consecutive turns, all inside the outreach interval that used to stop turn 2.
    twilioCalls.length = 0
    const t1 = await processInbound({ channel: 'sms', from: PHONE, body: 'What is term life insurance?', provider: 'twilio', providerId: 'SM_freq_1' })
    const t2 = await processInbound({ channel: 'sms', from: PHONE, body: 'Great, and what does the review cover?', provider: 'twilio', providerId: 'SM_freq_2' })
    const t3 = await processInbound({ channel: 'sms', from: PHONE, body: 'Sounds useful, how long does it take?', provider: 'twilio', providerId: 'SM_freq_3' })
    console.log(`    → turns sent: ${[t1, t2, t3].map((t) => t.autoReplied).join(', ')} (${twilioCalls.length} provider calls)`)
    check('a multi-turn conversation is no longer stalled by the outreach interval', () => {
      assert.deepEqual([t1.autoReplied, t2.autoReplied, t3.autoReplied], [true, true, true],
        'a turn was deferred inside the reply window')
      assert.equal(twilioCalls.length, 3)
    })
    check('every turn still records SERVICING and passes the full gate', () => {
      assert.equal(q(dbF, `select count(*) from comm_messages where direction='outbound' and delivery_status='sent' and purpose='SERVICING'`), '3')
      assert.equal(q(dbF, `select count(*) from comm_messages where direction='outbound' and blocked_step is not null`), '0')
    })

    // The per-day ceiling is a REAL bound: drop it to 2 and the third turn must be held.
    const dbC = freshDb({ armed: true })
    q(dbC, `update comm_frequency_policy set max_sms_per_day = 2 where id='reply'`)
    twilioCalls.length = 0
    await processInbound({ channel: 'sms', from: PHONE, body: 'What is term life insurance?', provider: 'twilio', providerId: 'SM_cap_1' })
    await processInbound({ channel: 'sms', from: PHONE, body: 'And what does it cover?', provider: 'twilio', providerId: 'SM_cap_2' })
    const capped = await processInbound({ channel: 'sms', from: PHONE, body: 'How long does the review take?', provider: 'twilio', providerId: 'SM_cap_3' })
    const capRow = q(dbC, `select coalesce(delivery_status,'-')||'|'||coalesce(blocked_step,'-')||'|'||coalesce(block_reason,'-') from comm_messages where direction='outbound' order by created_at desc limit 1`)
    console.log(`    → with reply cap = 2/day, turn 3: ${capRow}`)
    check('the reply per-day ceiling still stops a send — it is a bound, not a bypass', () => {
      assert.equal(capped.autoReplied, false, 'the reply cap did not bind')
      assert.match(capRow, /^blocked\|frequency\|/, `unexpected outcome: ${capRow}`)
      assert.equal(twilioCalls.length, 2, 'a third SMS was placed past the reply cap')
    })
    // The gate classes `frequency` as a non-escalating deferral (right for a drip, which
    // retries next cycle) but tryAutoReply escalates on ANY non-send, so a capped REPLY still
    // reaches the FSA. Both halves are asserted so the distinction stays recorded.
    check('a capped reply writes no compliance_event (it is a deferral, not a violation)', () => {
      assert.equal(q(dbC, `select count(*) from compliance_events`), '0')
    })
    check('but a capped reply DOES reach the FSA queue — never silently dropped', () => {
      const row = q(dbC, `select reason||'|'||coalesce(note,'-') from agent_actions where kind='escalation' order by created_at desc limit 1`)
      assert.match(row, /^gate_blocked:frequency\|/, `escalation row was: ${row}`)
      assert.equal(capped.escalated, true)
    })
  }

  // ── SCENARIO 1d: the per-conversation AI turn ceiling (§4.2, migration 104) ────
  section('1d. AI turn ceiling — forced hand-off to the licensed FSA')
  {
    const dbT = freshDb({ armed: true })
    check('migration 104 gives comm_conversation_policy a turn ceiling', () => {
      assert.equal(q(dbT, `select max_ai_turns||'|'||enabled||'|'||is_assumption from comm_conversation_policy where id='global'`),
        '6|true|true')
    })
    check('a ceiling of 0 is rejected by the constraint (use ai_autoreply=false instead)', () => {
      let threw = false
      try { q(dbT, `update comm_conversation_policy set max_ai_turns = 0 where id='global'`) } catch { threw = true }
      assert.ok(threw, 'max_ai_turns >= 1 was not enforced')
    })

    // Tighten to 2 so the ceiling is reachable inside one test without 6 model round-trips.
    q(dbT, `update comm_conversation_policy set max_ai_turns = 2 where id='global'`)
    twilioCalls.length = 0
    const turns = []
    for (let i = 1; i <= 3; i++) {
      turns.push(await processInbound({ channel: 'sms', from: PHONE, body: `Question number ${i} about the review?`, provider: 'twilio', providerId: `SM_turn_${i}` }))
    }
    const convId = q(dbT, `select id from comm_conversations where contact='${PHONE}'`)
    const esc = q(dbT, `select reason||'|'||coalesce(note,'-') from agent_actions where kind='escalation' order by created_at desc limit 1`)
    console.log(`    → turns sent: ${turns.map((t) => t.autoReplied).join(', ')} (${twilioCalls.length} provider calls)`)
    console.log(`    → FSA queue entry: ${esc}`)

    check('the AI takes exactly the permitted number of turns, then stops', () => {
      assert.deepEqual(turns.map((t) => t.autoReplied), [true, true, false],
        'the ceiling did not bind on the third turn')
      assert.equal(twilioCalls.length, 2, 'a third SMS was placed past the ceiling')
    })
    check('reaching the ceiling HANDS OFF — it escalates with a reason, never goes quiet', () => {
      assert.equal(turns[2].escalated, true)
      assert.match(esc, /^turn_limit\|/, `escalation row was: ${esc}`)
      assert.match(esc, /2\/2 since the last human reply/, `reason lacks the counts: ${esc}`)
      assert.match(esc, /handing off to the licensed FSA/)
    })
    check('the thread is disarmed so it is visibly a human\'s now', () => {
      assert.equal(q(dbT, `select ai_autoreply from comm_conversations where id='${convId}'`), 'f')
    })
    check('the hand-off is written to the audit_log', () => {
      assert.ok(Number(q(dbT, `select count(*) from audit_log where action='ai.escalated' and diff::text like '%turn_limit%'`)) >= 1)
    })
    check('the ceiling is checked BEFORE the model — a hand-off costs no tokens', () => {
      // Two sends, two agent_runs. A third would mean the model was called for the turn that
      // was refused.
      assert.equal(q(dbT, `select count(*) from agent_runs where agent_key='conversation'`), '2')
    })
    check('no outbound row is created for the refused turn', () => {
      assert.equal(q(dbT, `select count(*) from comm_messages where direction='outbound'`), '2')
    })

    // A human reply RESETS the budget: the FSA took and returned control.
    const dbR = freshDb({ armed: true })
    q(dbR, `update comm_conversation_policy set max_ai_turns = 2 where id='global'`)
    twilioCalls.length = 0
    await processInbound({ channel: 'sms', from: PHONE, body: 'First question?', provider: 'twilio', providerId: 'SM_rst_1' })
    await processInbound({ channel: 'sms', from: PHONE, body: 'Second question?', provider: 'twilio', providerId: 'SM_rst_2' })
    // Markist replies from the inbox: a human-authored outbound on the thread.
    const convR = q(dbR, `select id from comm_conversations where contact='${PHONE}'`)
    // sent_at MUST come from the frozen clock, not the database clock. The frequency resolver
    // computes minutesSinceLastSend against the app's (frozen) now; a row stamped with the real
    // wall clock makes that interval negative once real time passes the frozen instant, and
    // `negative < min_interval` blocks the send — a time-of-day-dependent failure that has
    // nothing to do with what this scenario is testing.
    q(dbR, `insert into comm_messages (channel, direction, recipient, body, delivery_status, conversation_id, member_id, household_id, actor, ai_generated, sent_at)
            values ('sms','outbound','${PHONE}','Hi, Markist here — happy to help.','sent','${convR}','${IDS.member}','${IDS.household}','user:markist',false, '${IN_HOURS}')`)
    q(dbR, `update comm_conversations set ai_autoreply = true where id='${convR}'`)
    const afterHuman = await processInbound({ channel: 'sms', from: PHONE, body: 'Third question?', provider: 'twilio', providerId: 'SM_rst_3' })
    console.log(`    → after a human reply, next AI turn sent=${afterHuman.autoReplied}`)
    console.log(`      escalation: ${q(dbR, `select coalesce(reason,'-')||' | '||coalesce(note,'-') from agent_actions where kind='escalation' order by created_at desc limit 1`)}`)
    console.log(`      outbound rows: ${q(dbR, `select string_agg(coalesce(delivery_status,'-')||'/'||coalesce(blocked_step,'-')||'/ai='||ai_generated, ', ' order by created_at) from comm_messages where direction='outbound'`)}`)
    check('an FSA reply RESETS the AI turn budget', () => {
      assert.equal(afterHuman.autoReplied, true,
        'the budget did not reset after a human-authored outbound message')
    })

    // Per-campaign override: a row keyed by the thread's bound agent wins over 'global'.
    const dbO = freshDb({ armed: true })
    q(dbO, `update comm_conversations set agent_key = 'pipeline' where contact='${PHONE}'`)
    q(dbO, `insert into comm_conversation_policy (id, max_ai_turns, enabled, is_assumption, note)
            values ('pipeline', 1, true, true, 'per-campaign override under test')`)
    twilioCalls.length = 0
    const o1 = await processInbound({ channel: 'sms', from: PHONE, body: 'First?', provider: 'twilio', providerId: 'SM_ovr_1' })
    const o2 = await processInbound({ channel: 'sms', from: PHONE, body: 'Second?', provider: 'twilio', providerId: 'SM_ovr_2' })
    const escO = q(dbO, `select coalesce(note,'-') from agent_actions where kind='escalation' order by created_at desc limit 1`)
    console.log(`    → per-campaign override (pipeline=1): ${o1.autoReplied}, ${o2.autoReplied}`)
    check('a per-campaign policy row overrides the global ceiling', () => {
      assert.deepEqual([o1.autoReplied, o2.autoReplied], [true, false],
        'the pipeline override (1 turn) did not bind while global allows 6')
      assert.match(escO, /policy:pipeline/, `the escalation should name the deciding row: ${escO}`)
    })

    // Fail-closed: with NO policy row readable at all, the conversation hands off.
    const dbF2 = freshDb({ armed: true })
    q(dbF2, `delete from comm_conversation_policy`)
    twilioCalls.length = 0
    const noPolicy = await processInbound({ channel: 'sms', from: PHONE, body: 'Anything at all?', provider: 'twilio', providerId: 'SM_failclosed' })
    const escF = q(dbF2, `select reason||'|'||coalesce(note,'-') from agent_actions where kind='escalation' order by created_at desc limit 1`)
    console.log(`    → no policy row: sent=${noPolicy.autoReplied} | ${escF}`)
    check('FAIL CLOSED — an unreadable turn policy hands off rather than running unbounded', () => {
      assert.equal(noPolicy.autoReplied, false, 'the AI replied with no turn policy in place')
      assert.equal(twilioCalls.length, 0)
      assert.match(escF, /^turn_limit\|/, `escalation row was: ${escF}`)
      assert.equal(q(dbF2, `select count(*) from agent_runs`), '0', 'the model was called despite the fail-closed hand-off')
    })
  }

  // ── SCENARIO 2: webhook redelivery must not produce a second reply ─────────────
  section('2. Twilio webhook redelivery (same provider_id) is idempotent')
  {
    const db = freshDb({ armed: true })
    aiCalls.length = 0; twilioCalls.length = 0
    const first = await processInbound({ channel: 'sms', from: PHONE, body: 'Can we talk Tuesday?', provider: 'twilio', providerId: 'SM_dupe' })
    const aiAfterFirst = aiCalls.length
    const outAfterFirst = Number(q(db, `select count(*) from comm_messages where direction='outbound'`))
    const second = await processInbound({ channel: 'sms', from: PHONE, body: 'Can we talk Tuesday?', provider: 'twilio', providerId: 'SM_dupe' })

    check('the duplicate inbound is NOT recorded twice', () => {
      assert.equal(q(db, `select count(*) from comm_messages where provider_id='SM_dupe'`), '1')
    })
    check('the redelivery returns the existing message/conversation ids', () => {
      assert.equal(second.conversationId, first.conversationId)
      assert.equal(second.messageId, first.messageId)
    })
    check('the redelivery produces NO second model call', () => {
      assert.equal(aiCalls.length, aiAfterFirst, `model called again on redelivery (${aiCalls.length} vs ${aiAfterFirst})`)
    })
    check('the redelivery produces NO second outbound row', () => {
      assert.equal(Number(q(db, `select count(*) from comm_messages where direction='outbound'`)), outAfterFirst)
    })
    check('the DB unique index on provider_id is the hard backstop', () => {
      const idx = q(db, `select count(*) from pg_indexes where tablename='comm_messages' and indexdef ilike '%unique%provider_id%'`)
      assert.ok(Number(idx) >= 1, 'no unique index on comm_messages.provider_id')
    })
  }

  // ── SCENARIO 3: STOP ──────────────────────────────────────────────────────────
  section('3. STOP revokes consent, writes DNC, pauses enrollments')
  {
    // STOP is the FIRST inbound on this thread, so nothing else can have paused the
    // enrollment — this isolates what STOP itself does.
    const db = freshDb({ armed: true })
    aiCalls.length = 0; twilioCalls.length = 0
    const r = await processInbound({ channel: 'sms', from: PHONE, body: 'STOP', provider: 'twilio', providerId: 'SM_stop' })
    const aiAfterStop = aiCalls.length
    const twilioAfterStop = twilioCalls.length

    check('STOP is classified as an opt-out', () => { assert.equal(r.optedOut, true); assert.equal(r.intent, 'stop') })
    check('member channel consent is revoked', () => {
      assert.equal(q(db, `select status from consents where member_id='${IDS.member}' and channel='sms'`), 'revoked')
    })
    check('a DNC entry is written for the contact', () => {
      assert.equal(q(db, `select scope||'|'||channel from dnc_entries where contact='${PHONE}'`), 'internal|sms')
    })
    const enrollAfterStop = q(db, `select status||'|'||coalesce(pause_reason,'-') from comm_campaign_enrollments where id='${IDS.enrollment}'`)
    console.log(`    → enrollment after STOP: ${enrollAfterStop}`)
    check('a STOP CLOSES the enrollment — terminal, not paused', () => {
      // `opted_out` is terminal. Pausing would be wrong: resumePausedEnrollments returns a
      // `paused_for_conversation` row to `enrolled` after the quiet window, so an opt-out
      // would silently re-enter the sending population and escalate on every blocked attempt.
      assert.equal(enrollAfterStop.split('|')[0], 'opted_out',
        `enrollment after STOP was "${enrollAfterStop}"`)
    })
    check('the STOP is NOT recorded as a conversation pause (nothing for the resume job)', () => {
      assert.equal(q(db, `select count(*) from comm_campaign_enrollments where status='paused_for_conversation'`), '0',
        'a STOP left a row the quiet-window resume job would pick up')
    })
    check('the enrollment closure is audited against the member', () => {
      assert.ok(Number(q(db, `select count(*) from audit_log where entity='comm_campaign_enrollment' and diff::text like '%opted_out%'`)) >= 1)
    })
    const dbC = freshDb({ armed: true })
    await processInbound({ channel: 'sms', from: PHONE, body: 'Sounds good, what times work?', provider: 'twilio', providerId: 'SM_pause_ctl' })
    const enrollAfterReply = q(dbC, `select status||'|'||coalesce(pause_reason,'-') from comm_campaign_enrollments where id='${IDS.enrollment}'`)
    check('CONTROL — a non-keyword reply DOES pause the active enrollment', () => {
      assert.equal(enrollAfterReply, 'paused_for_conversation|inbound sms reply')
    })
    check('STOP never triggers an AI reply', () => {
      assert.equal(aiAfterStop, 0, 'the model was called on a STOP')
      assert.equal(twilioAfterStop, 0, 'an SMS was placed on a STOP')
    })
    check('the opt-out is recorded as an unsubscribed message event', () => {
      assert.ok(Number(q(db, `select count(*) from comm_message_events where event='unsubscribed'`)) >= 1)
    })
    check('the consent revoke is written to the append-only audit_log', () => {
      assert.ok(Number(q(db, `select count(*) from audit_log where action like 'consent%' or diff::text ilike '%inbound_stop%'`)) >= 1)
    })
  }

  // ── SCENARIO 3b: a STOP closes the campaign timelines too, and stays closed ────
  section('3b. STOP terminates the campaign timelines; START does not revive them')
  {
    const dbS = freshDb({ armed: true })
    // Each timeline requires its own campaign row (campaign_id is NOT NULL); the seed
    // migrations create them, so reuse whatever is there rather than inventing a second one.
    const lifeC = q(dbS, `select id from life_campaigns limit 1`)
    const wbC = q(dbS, `select id from pipeline_winback_campaigns limit 1`)
    const xsC = q(dbS, `select id from xsell_life_campaigns limit 1`)
    console.log(`    → campaigns present: life=${!!lifeC} winback=${!!wbC} xsell=${!!xsC}`)
    // One live enrollment in each of the three campaign timelines for this member.
    q(dbS, `insert into life_campaign_enrollments (campaign_id, household_id, member_id, status, baseline_date)
            values ('${lifeC}','${IDS.household}','${IDS.member}','active', current_date)`)
    q(dbS, `insert into pipeline_winback_enrollments (campaign_id, household_id, member_id, status, baseline_date)
            values ('${wbC}','${IDS.household}','${IDS.member}','active', current_date)`)
    // Cross-Sell Life pins the campaign VERSION on each enrollment (§15 immutability).
    const xsV = q(dbS, `select coalesce(max(version),1) from xsell_life_campaigns where id='${xsC}'`)
    q(dbS, `insert into xsell_life_campaign_enrollments (campaign_id, campaign_version, household_id, member_id, status, baseline_date)
            values ('${xsC}', ${xsV || 1}, '${IDS.household}','${IDS.member}','running', current_date)`)
    const readStates = () => q(dbS, `select
        (select status from life_campaign_enrollments where member_id='${IDS.member}')||'|'||
        (select status from pipeline_winback_enrollments where member_id='${IDS.member}')||'|'||
        (select status from xsell_life_campaign_enrollments where member_id='${IDS.member}')`)
    const before = readStates()
    await processInbound({ channel: 'sms', from: PHONE, body: 'STOP', provider: 'twilio', providerId: 'SM_stop_all' })
    const after = readStates()
    console.log(`    → life|winback|xsell  before: ${before}  after STOP: ${after}`)

    check('all three campaign timelines are live before the STOP (guard)', () => {
      assert.equal(before, 'active|active|running')
    })
    check('a STOP closes all three campaign timelines', () => {
      // Life/Win-Back use `exited`; Cross-Sell Life's §15 machine has no exited state and
      // uses `suppressed` for an excluded contact.
      assert.equal(after, 'exited|exited|suppressed', `unexpected states: ${after}`)
    })
    check('each closure records exit_reason = opted_out', () => {
      for (const t of ['life_campaign_enrollments', 'pipeline_winback_enrollments', 'xsell_life_campaign_enrollments']) {
        assert.equal(q(dbS, `select coalesce(exit_reason,'-') from ${t} where member_id='${IDS.member}'`), 'opted_out', t)
      }
    })
    check('no campaign row is left in a state the resume job would pick up', () => {
      for (const t of ['life_campaign_enrollments', 'pipeline_winback_enrollments', 'xsell_life_campaign_enrollments']) {
        assert.equal(q(dbS, `select count(*) from ${t} where status='paused_for_conversation'`), '0', t)
      }
    })

    // A later START restores consent for future 1:1 contact but must NOT revive the campaigns.
    await processInbound({ channel: 'sms', from: PHONE, body: 'START', provider: 'twilio', providerId: 'SM_start_all' })
    check('a later START does NOT revive any closed campaign timeline', () => {
      assert.equal(readStates(), 'exited|exited|suppressed', `START revived a campaign: ${readStates()}`)
    })
    check('…while consent itself IS restored (the two are separate decisions)', () => {
      assert.equal(q(dbS, `select status from consents where member_id='${IDS.member}' and channel='sms'`), 'granted')
    })
  }

  // ── SCENARIO 3c: booking a review exits ALL THREE cadences ────────────────────
  // book.ts exited Cross-Sell Life and Life Conversion and not Win-Back, because Win-Back had
  // no inbound.ts seam. A stalled-pipeline contact who booked a review kept receiving
  // re-engagement touches. This drives the three exit functions against real rows.
  section('3c. Booking exit — Win-Back reaches parity with the other two cadences')
  {
    const dbX = freshDb()
    const lifeC = q(dbX, `select id from life_campaigns limit 1`)
    const wbC = q(dbX, `select id from pipeline_winback_campaigns limit 1`)
    const xsC = q(dbX, `select id from xsell_life_campaigns limit 1`)
    const xsV = q(dbX, `select coalesce(max(version),1) from xsell_life_campaigns where id='${xsC}'`)
    const seed = () => {
      q(dbX, `delete from life_campaign_enrollments; delete from pipeline_winback_enrollments; delete from xsell_life_campaign_enrollments`)
      q(dbX, `insert into life_campaign_enrollments (campaign_id, household_id, member_id, status, baseline_date)
              values ('${lifeC}','${IDS.household}','${IDS.member}','active', current_date)`)
      q(dbX, `insert into pipeline_winback_enrollments (campaign_id, household_id, member_id, status, baseline_date)
              values ('${wbC}','${IDS.household}','${IDS.member}','active', current_date)`)
      q(dbX, `insert into xsell_life_campaign_enrollments (campaign_id, campaign_version, household_id, member_id, status, baseline_date)
              values ('${xsC}', ${xsV || 1}, '${IDS.household}','${IDS.member}','running', current_date)`)
    }
    seed()
    const counts = await Promise.all([
      exitLife({ householdId: IDS.household, actor: 'booking' }),
      exitXsell({ householdId: IDS.household, actor: 'booking' }),
      exitWinback({ householdId: IDS.household, actor: 'booking' }),
    ])
    const wbRow = q(dbX, `select status||'|'||coalesce(exit_reason,'-')||'|'||(completed_at is not null) from pipeline_winback_enrollments where member_id='${IDS.member}'`)
    console.log(`    → exits: life=${JSON.stringify(counts[0])} xsell=${JSON.stringify(counts[1])} winback=${JSON.stringify(counts[2])}`)
    console.log(`    → win-back row after booking: ${wbRow}`)

    check('the Win-Back enrollment is exited by a booking', () => {
      assert.equal(wbRow, 'exited|appointment_booked|true', `unexpected row: ${wbRow}`)
    })
    check('all three cadences are closed, none left live', () => {
      assert.equal(q(dbX, `select count(*) from life_campaign_enrollments where status='active'`), '0')
      assert.equal(q(dbX, `select count(*) from pipeline_winback_enrollments where status='active'`), '0')
      assert.equal(q(dbX, `select count(*) from xsell_life_campaign_enrollments where status='running'`), '0')
    })
    check('the Win-Back exit is audited against the enrollment record', () => {
      assert.ok(Number(q(dbX, `select count(*) from audit_log where entity='pipeline_winback_enrollment' and diff::text like '%appointment_booked%'`)) >= 1)
    })
    check('a SECOND booking exits nothing — idempotent, no duplicate audit', () => {
      const auditBefore = q(dbX, `select count(*) from audit_log where entity='pipeline_winback_enrollment'`)
      return exitWinback({ householdId: IDS.household, actor: 'booking' }).then((again) => {
        assert.equal(again.exited, 0, 'a second booking re-exited a terminal enrollment')
        assert.equal(q(dbX, `select count(*) from audit_log where entity='pipeline_winback_enrollment'`), auditBefore)
      })
    })
    check('a paused Win-Back enrollment is also exited (not only an active one)', () => {
      seed()
      q(dbX, `update pipeline_winback_enrollments set status='paused_for_conversation' where member_id='${IDS.member}'`)
      return exitWinback({ householdId: IDS.household, actor: 'booking' }).then((r2) => {
        assert.equal(r2.exited, 1, 'a paused cadence survived the booking')
        assert.equal(q(dbX, `select status from pipeline_winback_enrollments where member_id='${IDS.member}'`), 'exited')
      })
    })
    check('another household is untouched (the exit is scoped)', () => {
      seed()
      const other = '99999999-9999-9999-9999-999999999999'
      q(dbX, `insert into households (id, primary_name) values ('${other}','Other Household')`)
      q(dbX, `insert into pipeline_winback_enrollments (campaign_id, household_id, status, baseline_date)
              values ('${wbC}','${other}','active', current_date)`)
      return exitWinback({ householdId: IDS.household, actor: 'booking' }).then(() => {
        assert.equal(q(dbX, `select status from pipeline_winback_enrollments where household_id='${other}'`), 'active')
      })
    })
  }

  // ── SCENARIO 4: START ─────────────────────────────────────────────────────────
  section('4. START clears DNC but does NOT auto-resume promotional enrollments')
  {
    const db = freshDb({ armed: true })
    // A real reply PAUSES the enrollment (conversation mode). This scenario is about whether a
    // later START silently re-enrols — so the row must be genuinely paused, not opted out.
    // NB: "yes" is a carrier START keyword (keywords.ts), so the priming reply must not
    // begin with it or it classifies as an opt-in instead of a normal message.
    await processInbound({ channel: 'sms', from: PHONE, body: 'Sounds good, what times work?', provider: 'twilio', providerId: 'SM_reply_4' })
    const pausedAfterReply = q(db, `select status from comm_campaign_enrollments where id='${IDS.enrollment}'`)
    // A DNC entry to clear: written by a STOP on a DIFFERENT contact-linked path would also do,
    // but the honest setup is a real STOP — on a second thread, so this member's PAUSED drip
    // row survives for the re-enrolment question below.
    q(db, `insert into dnc_entries (contact, channel, scope, reason) values ('${PHONE}','sms','internal','test STOP')`)
    q(db, `update consents set status='revoked' where member_id='${IDS.member}' and channel='sms'`)
    aiCalls.length = 0; twilioCalls.length = 0
    const r = await processInbound({ channel: 'sms', from: PHONE, body: 'START', provider: 'twilio', providerId: 'SM_start_4' })

    check('START is classified as an opt-in', () => { assert.equal(r.optedIn, true); assert.equal(r.intent, 'start') })
    check('the DNC entry is cleared', () => {
      assert.equal(q(db, `select count(*) from dnc_entries where contact='${PHONE}' and scope='internal'`), '0')
    })
    check('channel consent is restored to granted', () => {
      assert.equal(q(db, `select status from consents where member_id='${IDS.member}' and channel='sms'`), 'granted')
    })
    check('the paused promotional enrollment is NOT auto-resumed', () => {
      assert.equal(pausedAfterReply, 'paused_for_conversation', 'precondition: the reply paused the enrollment')
      assert.equal(q(db, `select status from comm_campaign_enrollments where id='${IDS.enrollment}'`), 'paused_for_conversation',
        'START silently re-enrolled the contact into promotional automation')
    })
    check('START never triggers an AI reply', () => { assert.equal(aiCalls.length, 0); assert.equal(twilioCalls.length, 0) })
  }

  // ── SCENARIO 5: securities firewall ───────────────────────────────────────────
  section('5. A securities-flagged thread escalates and never auto-replies')
  {
    // Armed on purpose: the firewall must win over the per-thread toggle.
    const db = freshDb({ securities: true, armed: true })
    aiCalls.length = 0; twilioCalls.length = 0
    const r = await processInbound({ channel: 'sms', from: PHONE, body: 'How is my account doing?', provider: 'twilio', providerId: 'SM_sec' })

    check('the thread carries the server-derived is_security flag', () => {
      assert.equal(q(db, `select is_security from comm_conversations where contact='${PHONE}'`), 't')
    })
    check('the securities thread escalates instead of replying', () => {
      assert.equal(r.escalated, true); assert.equal(r.autoReplied, false)
    })
    check('the escalation reason is the firewall, recorded on agent_actions', () => {
      assert.equal(q(db, `select kind||'|'||outcome||'|'||reason from agent_actions order by created_at desc limit 1`),
        'escalation|escalated|securities_thread')
    })
    check('the model is NEVER called on a securities thread', () => {
      assert.equal(aiCalls.length, 0, 'the AI drafted on a securities-flagged thread')
    })
    check('no outbound message row is produced', () => {
      assert.equal(q(db, `select count(*) from comm_messages where direction='outbound'`), '0')
    })
    check('the escalation is written to the audit_log', () => {
      assert.ok(Number(q(db, `select count(*) from audit_log where action='ai.escalated'`)) >= 1)
    })
  }

  // ── SCENARIO 6: ai_autoreply = false ──────────────────────────────────────────
  section('6. A thread with ai_autoreply=false escalates to the FSA queue')
  {
    const db = freshDb()
    aiCalls.length = 0; twilioCalls.length = 0
    const r = await processInbound({ channel: 'sms', from: PHONE, body: 'Do you have time this week?', provider: 'twilio', providerId: 'SM_noauto' })

    check('ai_autoreply defaults to false on an inbound-initiated thread (migration 033)', () => {
      assert.equal(q(db, `select ai_autoreply from comm_conversations where contact='${PHONE}'`), 'f')
    })
    check('the inbound escalates to the FSA queue', () => {
      assert.equal(r.escalated, true); assert.equal(r.autoReplied, false)
      assert.equal(q(db, `select kind||'|'||reason from agent_actions order by created_at desc limit 1`),
        'escalation|inbound_awaiting_reply')
    })
    check('no model call and no outbound message', () => {
      assert.equal(aiCalls.length, 0)
      assert.equal(q(db, `select count(*) from comm_messages where direction='outbound'`), '0')
    })
    check('the inbound is still fully recorded + threaded (nothing dropped)', () => {
      assert.equal(q(db, `select count(*) from comm_messages where provider_id='SM_noauto' and direction='inbound'`), '1')
      assert.equal(q(db, `select unread_count::text||'|'||last_direction from comm_conversations where contact='${PHONE}'`), '1|inbound')
    })
  }

  // ── SCENARIO 7: the responder receives prior turns ────────────────────────────
  section('7. draftReply receives prior turns (multi-turn context)')
  {
    const db = freshDb({ armed: true })
    aiReply = 'Great question — term life covers a set period. Want me to find a time to go over it?'
    await processInbound({ channel: 'sms', from: PHONE, body: 'I have a term policy from 2015.', provider: 'twilio', providerId: 'SM_t1' })
    aiReply = 'Yes — I can look at that with you. What day works?'
    await processInbound({ channel: 'sms', from: PHONE, body: 'Does it still make sense for me?', provider: 'twilio', providerId: 'SM_t2' })

    const lastPrompt = aiCalls.length ? JSON.stringify(aiCalls[aiCalls.length - 1]) : ''
    if (process.env.DUMP_PROMPT === '1') console.log('    PROMPT:', lastPrompt.slice(0, 4000))
    check('the model was called on the follow-up turn', () => {
      assert.ok(aiCalls.length >= 2, `expected >=2 model calls across the two turns, got ${aiCalls.length}`)
    })
    check('the follow-up prompt carries the EARLIER inbound turn (real transcript)', () => {
      assert.ok(lastPrompt.includes('I have a term policy from 2015.'),
        'the prior contact turn is absent from the prompt actually sent to the model')
    })
    check('the follow-up prompt carries the EARLIER outbound reply (both sides of the thread)', () => {
      assert.ok(lastPrompt.includes('term life covers a set period'),
        'the prior AI reply is absent from the prompt — only one side of the thread was passed')
    })
    check('the transcript is labelled Contact/Markist, and the latest inbound is separated', () => {
      assert.ok(lastPrompt.includes('CONVERSATION SO FAR'), 'transcript block missing')
      assert.ok(lastPrompt.includes('LATEST INBOUND FROM CONTACT'), 'latest-inbound block missing')
      assert.ok(lastPrompt.includes('Does it still make sense for me?'), 'the latest inbound is missing')
    })
    aiReply = 'Happy to help! Would you like me to set up a time for Markist to walk you through your options?'
  }

  // ── SCENARIO 8: the switches, proven one at a time ────────────────────────────
  section('8. The switches that govern whether an auto-reply may send')
  {
    const db = freshDb()
    check('ai_policies has the seeded global row with gateway_enabled = true', () => {
      assert.equal(q(db, `select id||'|'||gateway_enabled from ai_policies where id='global'`), 'global|true')
    })
    check('ai_agents has the seeded "conversation" agent, enabled = true', () => {
      assert.equal(q(db, `select key||'|'||enabled||'|'||is_guardrail from ai_agents where key='conversation'`), 'conversation|true|false')
    })
    check('comm_conversations.ai_autoreply defaults to false per thread', () => {
      const def = q(db, `select column_default from information_schema.columns where table_name='comm_conversations' and column_name='ai_autoreply'`)
      assert.equal(def, 'false')
    })

    // Global gateway kill switch OFF → the reply must not send.
    const db2 = freshDb({ armed: true })
    q(db2, `update ai_policies set gateway_enabled = false where id='global'`)
    aiCalls.length = 0; twilioCalls.length = 0
    const rOff = await processInbound({ channel: 'sms', from: PHONE, body: 'Question about coverage', provider: 'twilio', providerId: 'SM_kill1' })
    check('gateway_enabled=false blocks the reply and escalates', () => {
      assert.equal(rOff.autoReplied, false); assert.equal(rOff.escalated, true)
      assert.equal(twilioCalls.length, 0, 'an SMS went out with the gateway kill switch off')
    })

    // Per-agent kill switch OFF.
    const db3 = freshDb({ armed: true })
    q(db3, `update ai_agents set enabled = false where key='conversation'`)
    aiCalls.length = 0; twilioCalls.length = 0
    const rAgentOff = await processInbound({ channel: 'sms', from: PHONE, body: 'Question about coverage', provider: 'twilio', providerId: 'SM_kill2' })
    check('ai_agents.enabled=false for "conversation" blocks the reply and escalates', () => {
      assert.equal(rAgentOff.autoReplied, false); assert.equal(rAgentOff.escalated, true)
      assert.equal(twilioCalls.length, 0, 'an SMS went out with the conversation agent disabled')
    })

    // A2P go-live flag OFF → SMS is held (non-escalating hold at gate step sms_live).
    const db4 = freshDb({ armed: true })
    process.env.SMS_A2P_APPROVED = 'false'
    aiCalls.length = 0; twilioCalls.length = 0
    const rA2p = await processInbound({ channel: 'sms', from: PHONE, body: 'Question about coverage', provider: 'twilio', providerId: 'SM_a2p' })
    process.env.SMS_A2P_APPROVED = 'true'
    check('SMS_A2P_APPROVED unset holds the SMS (no provider call)', () => {
      assert.equal(rA2p.autoReplied, false)
      assert.equal(twilioCalls.length, 0, 'an SMS was placed before A2P approval')
    })
  }

  // ── SCENARIO 9: hours of operation on a live conversation (Phase 4 evidence) ──
  // NOTE ON METHOD: driving this through processInbound() would prove nothing, because the
  // AI-authority hold (scenario 1) fires BEFORE the 7-step gate and every outcome would read
  // `ai_authority` regardless of the clock. To get real evidence about hours, the send is
  // driven through the SAME sendThroughGate() the auto-reply uses, with the ONE thing the
  // auto-reply is missing supplied — a positively classified auto-send class + a purpose —
  // i.e. exactly what a repaired tryAutoReply() would pass. Nothing in the gate is relaxed.
  section('9. Hours of operation on a live conversation (Phase 4 evidence)')
  {
    const replyCtx = (conversationId) => ({
      channel: 'sms', to: PHONE, body: 'Happy to help — what time works for you this week?',
      actor: 'agent:conversation', memberId: IDS.member, householdId: IDS.household,
      entity: { type: 'conversation', id: conversationId }, isSecurity: false,
      aiGenerated: true, conversationId,
      // The two fields tryAutoReply() does not pass today.
      aiMessageClass: 'availability_question', purpose: 'SERVICING',
    })

    // (a) 13:00 recipient-local — inside the TCPA floor AND inside hours of operation.
    freezeClock(IN_HOURS)
    const dbA = freshDb({ armed: true })
    const convA = q(dbA, `select id from comm_conversations where contact='${PHONE}'`)
    twilioCalls.length = 0
    const okOutcome = await sendThroughGate(replyCtx(convA))
    console.log(`    → 13:00 local: sent=${okOutcome.sent} step=${okOutcome.gate.blockedStep ?? '-'}`)
    check('13:00 local — a classified AI reply passes the full gate and sends', () => {
      assert.equal(okOutcome.sent, true, `blocked at ${okOutcome.gate.blockedStep}: ${okOutcome.gate.reason}`)
      assert.equal(twilioCalls.length, 1, 'no SMS was placed with the provider')
    })

    // (b) 19:30 recipient-local — INSIDE the TCPA floor (9–20), OUTSIDE the seeded hours of
    //     operation (9–19, Mon–Sat). This is the window the Phase 4 question is about.
    freezeClock('2026-08-07T01:30:00.000Z')
    const dbB = freshDb({ armed: true })
    const convB = q(dbB, `select id from comm_conversations where contact='${PHONE}'`)
    twilioCalls.length = 0
    const lateOutcome = await sendThroughGate(replyCtx(convB))
    console.log(`    → 19:30 local: sent=${lateOutcome.sent} step=${lateOutcome.gate.blockedStep ?? '-'} escalate=${lateOutcome.gate.escalate}`)
    check('19:30 local — the reply is held at gate step business_hours, NOT quiet_hours', () => {
      assert.equal(lateOutcome.sent, false)
      assert.equal(lateOutcome.gate.blockedStep, 'business_hours',
        `blocked at ${lateOutcome.gate.blockedStep} instead: ${lateOutcome.gate.reason}`)
      assert.equal(twilioCalls.length, 0, 'an SMS was placed outside hours of operation')
    })
    // The GATE does not escalate a business_hours hold (it is an operational deferral, not a
    // compliance failure). Case (e) below shows the conversation path escalates on top of it,
    // so a held REPLY is not invisible — a held CAMPAIGN touch is.
    check('19:30 local — the gate itself does NOT escalate a business_hours hold', () => {
      assert.equal(lateOutcome.gate.escalate, false,
        'business_hours is documented as a non-escalating deferral')
      assert.equal(q(dbB, `select count(*) from agent_actions where kind='escalation'`), '0')
    })
    check('19:30 local — the held reply is recorded on the message row for the operator', () => {
      assert.equal(q(dbB, `select coalesce(delivery_status,'-')||'|'||coalesce(blocked_step,'-') from comm_messages where direction='outbound' order by created_at desc limit 1`),
        'blocked|business_hours')
    })

    // (c) 20:30 recipient-local — outside the non-negotiable TCPA quiet-hours floor.
    freezeClock('2026-08-07T02:30:00.000Z')
    const dbC2 = freshDb({ armed: true })
    const convC = q(dbC2, `select id from comm_conversations where contact='${PHONE}'`)
    twilioCalls.length = 0
    const nightOutcome = await sendThroughGate(replyCtx(convC))
    console.log(`    → 20:30 local: sent=${nightOutcome.sent} step=${nightOutcome.gate.blockedStep ?? '-'} escalate=${nightOutcome.gate.escalate}`)
    check('20:30 local — the reply is blocked by the quiet-hours floor and escalates', () => {
      assert.equal(nightOutcome.sent, false)
      assert.equal(nightOutcome.gate.blockedStep, 'quiet_hours')
      assert.equal(nightOutcome.gate.escalate, true)
      assert.equal(twilioCalls.length, 0)
    })

    // (d) Sunday 13:00 local — inside the TCPA floor, but the seeded hours-of-operation
    //     policy excludes day 0, so a live conversation is silent all day Sunday.
    freezeClock('2026-08-09T19:00:00.000Z') // 2026-08-09 is a Sunday
    const dbD = freshDb({ armed: true })
    const convD = q(dbD, `select id from comm_conversations where contact='${PHONE}'`)
    twilioCalls.length = 0
    const sundayOutcome = await sendThroughGate(replyCtx(convD))
    console.log(`    → Sunday 13:00 local: sent=${sundayOutcome.sent} step=${sundayOutcome.gate.blockedStep ?? '-'}`)
    check('Sunday 13:00 local — held at business_hours (the seeded policy is Mon–Sat)', () => {
      assert.equal(sundayOutcome.sent, false)
      assert.equal(sundayOutcome.gate.blockedStep, 'business_hours')
      assert.equal(twilioCalls.length, 0)
    })

    // (e) The same 19:30 hold, driven through the REAL inbound path, to establish what the
    //     FSA actually sees when a live reply is held outside hours of operation.
    freezeClock('2026-08-07T01:30:00.000Z')
    const dbE = freshDb({ armed: true })
    twilioCalls.length = 0
    const rE = await processInbound({ channel: 'sms', from: PHONE, body: 'What is term life insurance?', provider: 'twilio', providerId: 'SM_hours_inbound' })
    const escRow = q(dbE, `select coalesce(reason,'-')||'|'||coalesce(note,'-') from agent_actions where kind='escalation' order by created_at desc limit 1`)
    const msgRow = q(dbE, `select coalesce(delivery_status,'-')||'|'||coalesce(blocked_step,'-') from comm_messages where direction='outbound' order by created_at desc limit 1`)
    console.log(`    → 19:30 via processInbound: sent=${rE.autoReplied} row=${msgRow}`)
    console.log(`    → FSA queue entry: ${escRow}`)
    check('19:30 via processInbound — the reply is held and nothing reaches the contact', () => {
      assert.equal(rE.autoReplied, false)
      assert.equal(twilioCalls.length, 0)
      assert.equal(msgRow, 'blocked|business_hours')
    })
    check('19:30 via processInbound — the FSA queue DOES get an entry naming the gate step', () => {
      assert.match(escRow, /^gate_blocked:business_hours\|/, `escalation row was: ${escRow}`)
      assert.equal(rE.escalated, true)
    })

    freezeClock(IN_HOURS)
  }
} catch (err) {
  console.error('\nHARNESS ERROR:', err && err.stack ? err.stack : err)
  exitCode = 1
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -m immediate stop > /dev/null 2>&1`) } catch { /* ignore */ }
  globalThis.Date = RealDate
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('\nFAILED:')
  for (const f of failed) console.log(`  ✗ ${f.name}\n      ${f.err}`)
}
process.exit(exitCode || (failed.length ? 1 : 0))
