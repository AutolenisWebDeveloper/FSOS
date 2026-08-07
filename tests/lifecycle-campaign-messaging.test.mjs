// tests/lifecycle-campaign-messaging.test.mjs
// GUARDRAIL TEST for the lifecycle campaign messaging (the CURRENT copy migrations).
//
// The seed migrations (082/084/086) and the superseded copy passes (099/100/101, 108) are
// applied and immutable; the CURRENT copy ships as in-place template UPDATEs in 106 (Win-Back,
// v3), 107 (Cross-Sell Life, v3), and 110 (Life Conversion, v4 — the conversion-focused copy).
// Those migrations carry ALL customer-facing copy, so they — not the seeds and not the
// superseded files — are what must be proven compliant.
//
// What this proves, per campaign:
//   1. Every body is recommendation-free (containsRecommendationLanguage → false). §4.2 red line.
//   2. Every body lands as approval_status='draft' at the campaign's current version with prior
//      approval cleared — nothing can dispatch until a human approves it (sendThroughGate refuses
//      an unapproved template). No campaign is approved or activated by this work.
//   3. Every {{merge_token}} is on that campaign's proven-resolvable allowlist, so no send can
//      hard-block on an unresolved BLOCKING-tier token (gate step 4b /
//      personalize.unresolvedBlockingTokens). Life Conversion alone may reference the verified
//      policy/conversion facts: its send path passes enrollment.policy_id into the gate, where
//      resolvePolicySource() resolves them fail-closed (ADR-020/§4.3 — a recipient whose record
//      lacks a referenced fact is blocked + escalated, never sent a guess).
//   4. Every template ID updated is one the seed migration actually created — so a touch row can
//      never point at a template this migration failed to rewrite.
//   5. SMS bodies carry NO opt-out text: dispatcher.ts appends SMS_OPT_OUT_FOOTER to every SMS,
//      and duplicating it wastes segment budget and reads as machine-generated.
//   6. Email bodies honour the wrapMarketingEmailBody contract: a Subject: line, a Preview: line,
//      exactly ONE closer block, and a single CTA line ending in {{scheduling_link}}.
//   7. IDENTITY (the v3 contract). FSOS is a B2B2C partnership: the FSA works WITH the client's
//      own Farmers agent and is never that agent, and "Markist Athelus Farmers Agency" is the
//      FSA's own practice, never the client's agency. So no body may contain {{agency_name}} or
//      cast the sender as the recipient's local agent, and any reference to the recipient's own
//      agent must go through {{agent_of_record_reference}} (resolved per recipient; degrades to
//      the approved generic "your Farmers agent" rather than guessing a name, §4.3).
//   8. INTRODUCE ONCE. Exactly one asset per channel (Email 1 / SMS 1 / AI 1) introduces the
//      sender and is flagged introduces_sender = true; no other body re-introduces. That flag is
//      what stops the platform disclosure (ADR-016) from prepending a second introduction.
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
// [display key, module dir, extra pure module holding that campaign's ADVISOR_SCRIPTS]. Only
// Cross-Sell Life keeps its advisor scripts in a separate file; the other two export them from
// playbooks.ts. Both surfaces are dispatched/spoken client-facing copy, so both are checked.
const PLAYBOOK_SRC = [
  ['Win-Back', 'pipeline-winback', null],
  ['Cross-Sell Life', 'cross-sell-life', 'advisor-scripts'],
  ['Life Conversion', 'life-campaign', null],
]
execSync(
  `npx tsc src/lib/compliance/guardrail.ts src/lib/comms/gsm7.ts ` +
    PLAYBOOK_SRC.map(([, d]) => `src/lib/${d}/playbooks.ts`).join(' ') + ' ' +
    PLAYBOOK_SRC.filter(([, , a]) => a).map(([, d, a]) => `src/lib/${d}/${a}.ts`).join(' ') +
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

// The tokens the campaign send path provably resolves. first_name, advisor_title and
// agent_of_record_reference are COSMETIC or always-resolved (agent_of_record_reference degrades
// to "your Farmers agent"); the rest are BLOCKING-tier and populated by buildRecipientContext().
// Introducing any other token risks a personalization hard-block at gate step 4b.
//
// agency_name is deliberately NOT here. It resolves fine — it is banned on MEANING: it is the
// FSA's own practice name, and in copy addressed to an agency's client it reads as the client's
// agency (see the identity assertion below).
const ALLOWED_TOKENS = new Set([
  'first_name', 'fsa_name', 'advisor_title', 'agent_of_record_reference',
  'scheduling_link', 'advisor_phone', 'advisor_email',
])

// The verified per-recipient policy/conversion facts ONLY the Life Conversion campaign may
// reference: its enrollment population comes from v_conversions_due (verified deadline from the
// imported FNWL conversion list, which also supplies policy_number and the convertible amount as
// face_amount), and its tick passes enrollment.policy_id into sendThroughGate so
// resolvePolicySource() resolves these BLOCKING-tier variables fail-closed per recipient.
// conversion_exam_clause is COSMETIC by design: it renders "with no new medical exam" ONLY when
// household_policies.conversion_no_exam is verified true, and otherwise degrades to the neutral
// "subject to the conversion provisions in your policy" — the §4.3 gate on the exam claim.
// Win-Back and Cross-Sell sends carry no policy context, so for them these tokens would
// hard-block every send and stay banned.
const LIFE_CONVERSION_FACT_TOKENS = [
  'policy_number', 'policy_face_amount', 'conversion_expiration_date',
  'days_until_conversion_expires', 'conversion_exam_clause',
]

const CAMPAIGNS = [
  {
    key: 'Win-Back',
    v2: 'supabase/migrations/106_pipeline_winback_messaging_v3.sql',
    seed: 'supabase/migrations/084_pipeline_winback_seed.sql',
    version: 3,
    expect: { email: 8, sms: 8, ai: 6 },
    prefixes: { email: 'a2b00000', sms: 'b2c00000', ai: 'c2d00000' },
    extraTokens: [],
  },
  {
    key: 'Cross-Sell Life',
    v2: 'supabase/migrations/107_cross_sell_life_messaging_v3.sql',
    seed: 'supabase/migrations/086_cross_sell_life_seed.sql',
    version: 3,
    expect: { email: 12, sms: 12, ai: 7 },
    prefixes: { email: 'e5c00000', sms: 'd5c00000', ai: 'c5c00000' },
    extraTokens: [],
  },
  {
    key: 'Life Conversion',
    v2: 'supabase/migrations/110_life_conversion_messaging_v4.sql',
    seed: 'supabase/migrations/082_life_conversion_seed.sql',
    version: 4,
    expect: { email: 7, sms: 6, ai: 5 },
    prefixes: { email: 'e1c00000', sms: 'd1c00000', ai: 'c1c00000' },
    extraTokens: LIFE_CONVERSION_FACT_TOKENS,
  },
]

/** Parse the copy migration into { id, body, introduces } records, in file order. */
function parseV2(sql) {
  // Each block is: update comm_templates set … body = $body$…$body$, introduces_sender = <bool>,
  // … where id = '<uuid>';
  const re = /body\s*=\s*\$body\$([\s\S]*?)\$body\$([\s\S]*?)where id = '([0-9a-f-]{36})';/g
  const rows = []
  let m
  while ((m = re.exec(sql)) !== null) {
    const tail = m[2]
    const flag = tail.match(/introduces_sender\s*=\s*(true|false)/)
    rows.push({ body: m[1], id: m[3], introduces: flag ? flag[1] === 'true' : null })
  }
  return rows
}

// The phrases that would put the sender in the wrong seat: presenting the FSA as the recipient's
// own agent, or the FSA's practice as the recipient's agency. Each is a real prior defect.
const MISIDENTIFICATION = [
  { re: /your (Farmers )?agent at\b/i, why: 'places the recipient\'s agent inside the FSA\'s practice' },
  { re: /\bI am your\b[^.]{0,40}\bagent\b/i, why: 'claims to BE the recipient\'s agent' },
  { re: /\bclient of \{\{agency_name\}\}/i, why: 'calls the recipient a client of the FSA\'s practice' },
  { re: /\byour local (Farmers )?agen(t|cy)\b/i, why: 'casts the sender as the local agent/agency' },
]

/** The introduction is recognisable by naming the sender, their role, and the client's agent. */
function introducesSender(body) {
  return /\{\{fsa_name\}\}/.test(body) && /\{\{advisor_title\}\}/.test(body) && /\{\{agent_of_record_reference\}\}/.test(body)
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
    const allowed = new Set([...ALLOWED_TOKENS, ...c.extraTokens])
    for (const r of rows) {
      for (const tok of tokensIn(r.body)) {
        assert.ok(allowed.has(tok), `unsupported token {{${tok}}} in ${r.id}`)
      }
    }
  })

  t(`every update lands as draft v${c.version} with prior approval cleared`, () => {
    const updates = sql.split(/^update comm_templates set$/m).slice(1)
    assert.equal(updates.length, total, 'update-statement count mismatch')
    for (const u of updates) {
      assert.match(u, /approval_status = 'draft'/, 'template not left in draft')
      assert.match(u, new RegExp(`version = ${c.version}\\b`), `version not bumped to ${c.version}`)
      assert.match(u, /approved_at = null/, 'stale approved_at not cleared')
      assert.match(u, /approved_by = null/, 'stale approved_by not cleared')
    }
  })

  // ── Identity: who the copy says is writing (§0 — the B2B2C partnership model) ──
  t('no body presents the FSA as the recipient\'s own agent or agency', () => {
    for (const r of rows) {
      assert.doesNotMatch(
        r.body, /\{\{\s*agency_name\s*\}\}/i,
        `${r.id} uses {{agency_name}} — the FSA's own practice name reads as the recipient's agency`,
      )
      for (const bad of MISIDENTIFICATION) {
        assert.doesNotMatch(r.body, bad.re, `${r.id} ${bad.why}`)
      }
    }
  })

  t('the recipient\'s own agent is only ever named through the resolved reference token', () => {
    for (const r of rows) {
      // A bare "your Farmers agent" is the token's own fallback wording, so authoring it as a
      // literal silently forfeits the resolved name the spine can supply for this recipient.
      const literal = r.body.replace(/\{\{agent_of_record_reference\}\}/g, '')
      assert.doesNotMatch(
        literal, /your Farmers agent/i,
        `${r.id} hardcodes "your Farmers agent" — use {{agent_of_record_reference}} so the real name resolves`,
      )
    }
  })

  // ── Introduce once per channel (ADR-016 + migration 105) ─────────────────────
  t('every update sets introduces_sender explicitly', () => {
    for (const r of rows) {
      assert.notEqual(r.introduces, null, `${r.id} does not set introduces_sender — the flag must be deliberate`)
    }
  })

  t('exactly one asset per channel introduces the sender, and it is the first touch', () => {
    for (const [channel, prefix] of Object.entries(c.prefixes)) {
      const inChannel = rows.filter((r) => r.id.startsWith(prefix))
      const flagged = inChannel.filter((r) => r.introduces)
      assert.equal(flagged.length, 1, `${c.key}/${channel} has ${flagged.length} introducing assets (must be exactly 1)`)
      assert.ok(
        flagged[0].id.endsWith('000000000001'),
        `${c.key}/${channel} flags ${flagged[0].id} rather than the first touch`,
      )
    }
  })

  t('the flagged asset actually carries the introduction, and no other body does', () => {
    for (const r of rows) {
      if (r.introduces) {
        assert.ok(
          introducesSender(r.body),
          `${r.id} is flagged introduces_sender but its copy does not name the FSA, their role, and the client's agent`,
        )
      } else {
        assert.ok(
          !introducesSender(r.body),
          `${r.id} re-introduces the sender on a later touch — the introduction belongs to touch 1 only`,
        )
      }
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

  t('SMS + AI bodies do NOT restate the opt-out (dispatcher appends the STOP footer)', () => {
    for (const r of [...smses, ...ais]) {
      assert.doesNotMatch(r.body, /reply stop/i, `${r.id} duplicates the appended opt-out footer`)
    }
  })

  t('SMS + AI bodies stay within a sane segment budget alongside the footer', () => {
    // SMS_OPT_OUT_FOOTER (+ "\n\n") costs 24 chars on the wire. The 235-char authored-body
    // ceiling is KEPT as-is even though the footer shrank by 47 chars: the headroom now
    // absorbs merge-token expansion (a long {{agency_name}} + {{fsa_name}}) instead, so a
    // typical send stays within 2 concatenated GSM-7 segments (306) after token expansion.
    for (const r of [...smses, ...ais]) {
      assert.ok(r.body.length <= 235, `${r.id} is ${r.body.length} chars (>235) before the 24-char footer`)
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
//
// Life Conversion playbooks may additionally reference the verified policy/conversion facts,
// but ONLY in `opening` — the opener is dispatched by the campaign tick, which passes
// enrollment.policy_id into the gate. followUp/handoff/closing are dispatched later by the AI
// responder with NO policy context, so a fact token there would hard-block every one of those
// sends. That split is asserted below, not just documented.
const PLAYBOOK_TOKENS = new Set([...ALLOWED_TOKENS, 'appointment_time'])
const PLAYBOOK_EXTRA_TOKENS = { 'Life Conversion': LIFE_CONVERSION_FACT_TOKENS }

/** The playbook surface carries the same identity contract as the migration bodies. */
function assertIdentitySafe(id, body) {
  assert.doesNotMatch(body, /\{\{\s*agency_name\s*\}\}/i, `${id} uses {{agency_name}}`)
  for (const bad of MISIDENTIFICATION) assert.doesNotMatch(body, bad.re, `${id} ${bad.why}`)
  const literal = body.replace(/\{\{agent_of_record_reference\}\}/g, '')
  assert.doesNotMatch(literal, /your Farmers agent/i, `${id} hardcodes "your Farmers agent"`)
}

for (const [key, dir, advisorFile] of PLAYBOOK_SRC) {
  const mod = require(join(out, dir, 'playbooks.js'))
  const advisorScripts =
    (advisorFile ? require(join(out, dir, `${advisorFile}.js`)).ADVISOR_SCRIPTS : mod.ADVISOR_SCRIPTS) ?? []
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
    const factTokens = new Set(PLAYBOOK_EXTRA_TOKENS[key] ?? [])
    for (const b of bodies) {
      // Fact tokens resolve ONLY on the tick-dispatched opener (policy context supplied there);
      // on the responder-dispatched fields they would hard-block, so they are banned there.
      const openerDispatched = b.id.endsWith('.opening')
      for (const m of b.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
        const tok = m[1].toLowerCase()
        if (openerDispatched && factTokens.has(tok)) continue
        assert.ok(
          PLAYBOOK_TOKENS.has(tok),
          `${b.id} uses token {{${m[1]}}} that does not resolve on this dispatch path — ` +
            `it would render EMPTY or hard-block the send`,
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

  t(`${key}: playbook bodies do NOT restate the opt-out (dispatcher appends the STOP footer)`, () => {
    for (const b of bodies) {
      assert.doesNotMatch(b.body, /reply stop/i, `${b.id} duplicates the appended opt-out footer`)
    }
  })

  t(`${key}: every playbook opener identifies itself as an automated assistant`, () => {
    for (const p of mod.PLAYBOOKS ?? []) {
      assert.match(p.opening, /automated assistant/i, `${key}/${p.key}.opening does not self-identify as AI`)
    }
  })

  // The advisor scripts are read aloud by the licensed FSA, so they are exempt from the SMS
  // segment/GSM-7 limits — but NOT from the identity contract. Saying "this is Markist with
  // Markist Athelus Farmers Agency, I work alongside your Farmers agent" out loud misidentifies
  // the relationship exactly as the written copy did.
  t(`${key}: every client-facing body identifies the sender correctly`, () => {
    for (const b of bodies) assertIdentitySafe(b.id, b.body)
    for (const s of advisorScripts) assertIdentitySafe(`${key}/script:${s.key}`, s.script)
  })

  t(`${key}: advisor scripts reference only resolvable merge tokens`, () => {
    for (const s of advisorScripts) {
      for (const m of s.script.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
        assert.ok(
          PLAYBOOK_TOKENS.has(m[1].toLowerCase()),
          `${key}/script:${s.key} uses unregistered token {{${m[1]}}}`,
        )
      }
    }
  })
}

console.log('')
if (failures > 0) {
  console.error(`${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('lifecycle campaign messaging: all checks passed')
