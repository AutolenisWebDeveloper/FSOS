// tests/lifecycle-campaign-messaging.test.mjs
// GUARDRAIL TEST for the rebuilt lifecycle campaign messaging (migrations 099/100/101).
//
// The seed migrations (082/084/086) are applied and immutable; the v2 copy ships as in-place
// template UPDATEs in 099 (Win-Back), 100 (Cross-Sell Life), 101 (Life Conversion). Those
// migrations carry ALL customer-facing copy, so they — not the seeds — are what must be proven
// compliant. Migration 084 previously had no test at all; this closes that gap for all three.
//
// What this proves, per campaign:
//   1. Every body is recommendation-free (containsRecommendationLanguage → false). §4.2 red line.
//   2. Every body lands as approval_status='draft' at version 2 with prior approval cleared —
//      nothing can dispatch until a human approves it (sendThroughGate refuses an unapproved
//      template). No campaign is approved or activated by this work.
//   3. Every {{merge_token}} is on the proven-resolvable allowlist, so no send can hard-block on
//      an unresolved BLOCKING-tier token (gate step 4b / personalize.unresolvedBlockingTokens).
//   4. Every template ID updated is one the seed migration actually created — so a touch row can
//      never point at a template this migration failed to rewrite.
//   5. SMS bodies carry NO opt-out/AI-disclosure text: dispatcher.ts appends TRAIGA_SMS_FOOTER to
//      every SMS, and duplicating it wastes segment budget and reads as machine-generated.
//   6. Email bodies honour the wrapMarketingEmailBody contract: a Subject: line, a Preview: line,
//      exactly ONE closer block, and a single CTA line ending in {{scheduling_link}}.
//
// Pure file parsing + the real pure guardrail — no DB, no network.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// ── Compile the pure guardrail (TS) so we test the REAL detector, not a copy ──
// Same commonjs + createRequire approach as tests/guardrail.test.mjs (guardrail.ts → compliance.ts).
// The three playbooks.ts files are pure data with NO imports, so they compile standalone and are
// require()'d as real parsed objects — no regex-scraping of source. --rootDir pins the emit layout
// so both the guardrail and the playbooks resolve at predictable paths.
const out = mkdtempSync(join(tmpdir(), 'fsos-msg-'))
const PLAYBOOK_SRC = [
  ['Win-Back', 'pipeline-winback'],
  ['Cross-Sell Life', 'cross-sell-life'],
  ['Life Conversion', 'life-campaign'],
]
execSync(
  `npx tsc src/lib/compliance/guardrail.ts src/lib/comms/gsm7.ts ` +
    PLAYBOOK_SRC.map(([, d]) => `src/lib/${d}/playbooks.ts`).join(' ') +
    ` --outDir ${out} --rootDir src/lib ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { containsRecommendationLanguage } = require(join(out, 'compliance/guardrail.js'))
// The SHARED GSM-7 definition (also used by console.smsSegmentInfo) — never a local copy.
const { nonGsm7Chars } = require(join(out, 'comms/gsm7.js'))

let failures = 0
function t(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${e.message}`) }
}

// The six tokens the campaign send path provably resolves: first_name is COSMETIC (safe
// default), the rest are BLOCKING-tier and populated by buildRecipientContext(). Introducing
// any other token risks a personalization hard-block at gate step 4b.
const ALLOWED_TOKENS = new Set([
  'first_name', 'fsa_name', 'agency_name', 'scheduling_link', 'advisor_phone', 'advisor_email',
])

const CAMPAIGNS = [
  {
    key: 'Win-Back',
    v2: 'supabase/migrations/099_pipeline_winback_messaging_v2.sql',
    seed: 'supabase/migrations/084_pipeline_winback_seed.sql',
    expect: { email: 8, sms: 8, ai: 6 },
    prefixes: { email: 'a2b00000', sms: 'b2c00000', ai: 'c2d00000' },
  },
  {
    key: 'Cross-Sell Life',
    v2: 'supabase/migrations/100_cross_sell_life_messaging_v2.sql',
    seed: 'supabase/migrations/086_cross_sell_life_seed.sql',
    expect: { email: 12, sms: 12, ai: 7 },
    prefixes: { email: 'e5c00000', sms: 'd5c00000', ai: 'c5c00000' },
  },
  {
    key: 'Life Conversion',
    v2: 'supabase/migrations/101_life_conversion_messaging_v2.sql',
    seed: 'supabase/migrations/082_life_conversion_seed.sql',
    expect: { email: 7, sms: 6, ai: 5 },
    prefixes: { email: 'e1c00000', sms: 'd1c00000', ai: 'c1c00000' },
  },
]

/** Parse the v2 migration into { id, body } records, in file order. */
function parseV2(sql) {
  // Each block is: update comm_templates set … body = $body$…$body$, … where id = '<uuid>';
  const re = /body\s*=\s*\$body\$([\s\S]*?)\$body\$[\s\S]*?where id = '([0-9a-f-]{36})';/g
  const rows = []
  let m
  while ((m = re.exec(sql)) !== null) rows.push({ body: m[1], id: m[2] })
  return rows
}

/** Every {{token}} referenced in a body, canonicalized to lowercase. */
function tokensIn(body) {
  return [...body.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1].toLowerCase())
}

// Optional single-campaign filter for incremental work: `node tests/…test.mjs "Win-Back"`.
// The full suite passes no argument, so CI always validates all three.
const only = process.argv[2]
const selected = only ? CAMPAIGNS.filter((c) => c.key.toLowerCase().includes(only.toLowerCase())) : CAMPAIGNS
assert.ok(selected.length > 0, `no campaign matches filter "${only}"`)

for (const c of selected) {
  console.log(`\n${c.key} — ${c.v2}`)
  const sql = readFileSync(c.v2, 'utf8')
  const seedSql = readFileSync(c.seed, 'utf8')
  const rows = parseV2(sql)
  const total = c.expect.email + c.expect.sms + c.expect.ai

  t('rewrites every seeded template exactly once', () => {
    assert.equal(rows.length, total, `expected ${total} template updates, found ${rows.length}`)
    const ids = rows.map((r) => r.id)
    assert.equal(new Set(ids).size, ids.length, 'a template id was updated twice')
  })

  t('every rewritten id exists in the applied seed migration', () => {
    for (const r of rows) {
      assert.ok(seedSql.includes(r.id), `id ${r.id} is not created by ${c.seed} — a touch row would keep old copy`)
    }
  })

  t('covers the full seeded asset set (no template left with v1 copy)', () => {
    // Every template UUID the seed inserts into comm_templates must be rewritten here.
    // The name literal may contain SQL-escaped quotes ('' — e.g. "We''d Still Love to Help"),
    // so match a full SQL string literal rather than a naive [^']* run.
    const seeded = new Set(
      [...seedSql.matchAll(/\('([0-9a-f-]{36})', '(?:[^']|'')*', '(?:sms|email)',/g)].map((m) => m[1]),
    )
    assert.equal(seeded.size, total, `seed defines ${seeded.size} templates, expected ${total}`)
    const rewritten = new Set(rows.map((r) => r.id))
    for (const id of seeded) assert.ok(rewritten.has(id), `seeded template ${id} was not rewritten`)
  })

  t('every campaign touch still references a rewritten template of the right channel', () => {
    // The v2 migrations rewrite template BODIES in place and never touch the touch rows, so the
    // schedule must still resolve. Prove it: for every touch row in the seed that carries a
    // template_id, that id must be one we rewrote, and the touch kind must match the template's
    // channel (an email touch pointing at an SMS template would silently mis-route).
    const rewritten = new Set(rows.map((r) => r.id))
    const channelOf = (id) =>
      id.startsWith(c.prefixes.email) ? 'email' : id.startsWith(c.prefixes.sms) ? 'sms' : 'ai'
    // touch rows: (campaign_id, touch_no, day_offset, kind, template_id[, playbook_key], label)
    const touchRe = /\('[0-9a-f-]{36}',\s*(\d+),\s*(\d+),\s*'(\w+)',\s*(?:'([0-9a-f-]{36})'|null)/g
    let m
    let checked = 0
    while ((m = touchRe.exec(seedSql)) !== null) {
      const [, touchNo, , kind, templateId] = m
      if (kind === 'advisor_outreach') {
        assert.equal(templateId, undefined, `advisor touch ${touchNo} should carry no template`)
        continue
      }
      assert.ok(templateId, `touch ${touchNo} (${kind}) has no template_id`)
      assert.ok(rewritten.has(templateId), `touch ${touchNo} points at ${templateId}, which was NOT rewritten`)
      const expected = kind === 'ai_conversation' ? 'ai' : kind
      assert.equal(
        channelOf(templateId), expected,
        `touch ${touchNo} is kind '${kind}' but its template is a ${channelOf(templateId)} asset`,
      )
      checked++
    }
    assert.equal(checked, total, `checked ${checked} sendable touches, expected ${total}`)
  })

  t('every body is free of recommendation language (§4.2 red line)', () => {
    for (const r of rows) {
      assert.equal(
        containsRecommendationLanguage(r.body), false,
        `recommendation language in ${r.id}: ${r.body.slice(0, 90)}…`,
      )
    }
  })

  t('every body uses only proven-resolvable merge tokens', () => {
    for (const r of rows) {
      for (const tok of tokensIn(r.body)) {
        assert.ok(ALLOWED_TOKENS.has(tok), `unsupported token {{${tok}}} in ${r.id}`)
      }
    }
  })

  t('every update lands as draft v2 with prior approval cleared', () => {
    const updates = sql.split(/^update comm_templates set$/m).slice(1)
    assert.equal(updates.length, total, 'update-statement count mismatch')
    for (const u of updates) {
      assert.match(u, /approval_status = 'draft'/, 'template not left in draft')
      assert.match(u, /version = 2/, 'version not bumped to 2')
      assert.match(u, /approved_at = null/, 'stale approved_at not cleared')
      assert.match(u, /approved_by = null/, 'stale approved_by not cleared')
    }
  })

  t('nothing in this migration approves or activates a campaign', () => {
    assert.doesNotMatch(sql, /approval_status\s*=\s*'approved'/, 'migration approves a template')
    assert.doesNotMatch(sql, /status\s*=\s*'active'/, 'migration activates a campaign')
  })

  // ── Channel-specific contracts ────────────────────────────────────────────
  const emails = rows.filter((r) => r.id.startsWith(c.prefixes.email))
  const smses = rows.filter((r) => r.id.startsWith(c.prefixes.sms))
  const ais = rows.filter((r) => r.id.startsWith(c.prefixes.ai))

  t(`channel split is ${c.expect.email} email / ${c.expect.sms} sms / ${c.expect.ai} ai`, () => {
    assert.equal(emails.length, c.expect.email, 'email count')
    assert.equal(smses.length, c.expect.sms, 'sms count')
    assert.equal(ais.length, c.expect.ai, 'ai opener count')
  })

  t('SMS + AI bodies do NOT restate the opt-out (dispatcher appends TRAIGA footer)', () => {
    for (const r of [...smses, ...ais]) {
      assert.doesNotMatch(r.body, /reply stop/i, `${r.id} duplicates the appended opt-out footer`)
    }
  })

  t('SMS + AI bodies stay within a sane segment budget alongside the footer', () => {
    // TRAIGA_SMS_FOOTER (+ "\n\n") costs 71 chars on the wire. Keep the authored body ≤ 235 so a
    // typical send stays within 2 concatenated GSM-7 segments (306) after token expansion.
    for (const r of [...smses, ...ais]) {
      assert.ok(r.body.length <= 235, `${r.id} is ${r.body.length} chars (>235) before the 71-char footer`)
    }
  })

  t('SMS + AI bodies stay GSM-7 safe (no UCS-2 downgrade)', () => {
    // A single em dash, curly quote, or ellipsis forces UCS-2, which cuts a segment from 153 to
    // 67 characters and can silently double or triple the cost/segment count of every send.
    // Uses the SHARED GSM-7 set (lib/comms/gsm7), the same definition the operator segment
    // preview uses — an ASCII-only approximation would wrongly reject valid GSM-7 (£, é, €).
    for (const r of [...smses, ...ais]) {
      const bad = nonGsm7Chars(r.body)
      assert.equal(bad.length, 0, `${r.id} has non-GSM-7 character(s): ${JSON.stringify(bad.join(''))}`)
    }
  })

  t('every AI opener identifies itself as an automated assistant', () => {
    for (const r of ais) {
      assert.match(r.body, /automated assistant/i, `${r.id} does not self-identify as AI`)
    }
  })

  t('email bodies honour the marketing-shell contract', () => {
    for (const r of emails) {
      const lines = r.body.split('\n')
      assert.match(lines[0], /^Subject: \S/, `${r.id} missing leading "Subject:" line`)
      assert.match(lines[1], /^Preview: \S/, `${r.id} missing "Preview:" line`)
      // Exactly one sign-off block, or the shell renders a duplicate signature.
      const closers = r.body
        .split(/\n{2,}/)
        .filter((b) => /^(sincerely|warm regards|warmly|kind regards|best regards|best wishes|respectfully|cordially|regards|thank you),/i.test(b.trim()))
      assert.equal(closers.length, 1, `${r.id} has ${closers.length} sign-off blocks (must be exactly 1)`)
      // Exactly one CTA line: "Label {{scheduling_link}}" on its own block, label ≤63 chars.
      const ctas = r.body
        .split(/\n{2,}/)
        .map((b) => b.trim())
        .filter((b) => /^\S.{0,63}?\s+\{\{scheduling_link\}\}$/.test(b))
      assert.equal(ctas.length, 1, `${r.id} has ${ctas.length} CTA button lines (must be exactly 1)`)
    }
  })

  t('email bodies never restate the SMS opt-out keyword', () => {
    for (const r of emails) {
      assert.doesNotMatch(r.body, /reply stop/i, `${r.id} carries SMS opt-out language in an email`)
    }
  })
}

// ── AI PLAYBOOK BODIES (the .ts surface the migration tests do NOT reach) ───────────────
// Each playbook's `opening` is duplicated into the v2 migration and therefore already covered
// above. `followUp` / `handoff` / `closing` and the event-driven SMS triggers live ONLY here and
// are dispatched VERBATIM by the AI responder, so they were entirely untested — the gap that let
// an unregistered {{appointment_date}} and a UCS-2 em dash through review. Same invariants as the
// migration bodies, applied to the real compiled objects.
console.log('\n▶ AI playbook dispatched bodies')

// appointment_time joins the six campaign tokens here: it is BLOCKING-tier, so if the booking
// context fails to supply it the send HARD-BLOCKS at gate step 4b. An UNREGISTERED token is the
// actual hazard — personalize.ts renders it as an empty string and does NOT block, silently
// shipping broken copy ("your meeting with Markist on  at ...").
const PLAYBOOK_TOKENS = new Set([...ALLOWED_TOKENS, 'appointment_time'])

for (const [key, dir] of PLAYBOOK_SRC) {
  const mod = require(join(out, dir, 'playbooks.js'))
  // Only CLIENT-FACING, dispatched fields. ADVISOR_SCRIPTS are internal call scripts a licensed
  // human reads aloud — never sent over SMS — so segment/GSM-7 limits do not apply to them.
  const bodies = []
  for (const p of mod.PLAYBOOKS ?? []) {
    for (const f of ['opening', 'followUp', 'handoff', 'closing']) {
      if (p[f]) bodies.push({ id: `${key}/${p.key}.${f}`, body: p[f] })
    }
  }
  for (const e of mod.EVENT_DRIVEN_SMS ?? []) {
    bodies.push({ id: `${key}/event:${e.key}`, body: e.body })
  }

  t(`${key}: playbook bodies are recommendation-free`, () => {
    assert.ok(bodies.length > 0, `${key} exposed no dispatched playbook bodies`)
    for (const b of bodies) {
      assert.equal(containsRecommendationLanguage(b.body), false, `${b.id} contains recommendation language`)
    }
  })

  t(`${key}: playbook bodies reference only resolvable merge tokens`, () => {
    for (const b of bodies) {
      for (const m of b.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
        assert.ok(
          PLAYBOOK_TOKENS.has(m[1].toLowerCase()),
          `${b.id} uses unregistered token {{${m[1]}}} — renders EMPTY without blocking`,
        )
      }
    }
  })

  t(`${key}: playbook bodies stay GSM-7 safe (no UCS-2 downgrade)`, () => {
    for (const b of bodies) {
      const bad = nonGsm7Chars(b.body)
      assert.equal(bad.length, 0, `${b.id} has non-GSM-7 character(s): ${JSON.stringify(bad.join(''))}`)
    }
  })

  t(`${key}: playbook bodies do NOT restate the opt-out (dispatcher appends TRAIGA footer)`, () => {
    for (const b of bodies) {
      assert.doesNotMatch(b.body, /reply stop/i, `${b.id} duplicates the appended opt-out footer`)
    }
  })

  t(`${key}: every playbook opener identifies itself as an automated assistant`, () => {
    for (const p of mod.PLAYBOOKS ?? []) {
      assert.match(p.opening, /automated assistant/i, `${key}/${p.key}.opening does not self-identify as AI`)
    }
  })
}

console.log('')
if (failures > 0) {
  console.error(`${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('lifecycle campaign messaging: all checks passed')
