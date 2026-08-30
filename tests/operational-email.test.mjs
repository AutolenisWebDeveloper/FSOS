// Operational / transactional email proof.
//
// Scope: the EVENT-TRIGGERED transactional sends — NOT campaign email (lib/comms).
//   1. lib/messaging.ts  sendEmail  — the single shared Resend wrapper every
//      operational send now routes through. Proven against a MOCKED Resend
//      (no live send): it sends on trigger with the right from/to/subject/body,
//      applies reply-to, and its config guards fail closed WITHOUT calling Resend.
//   2. lib/forms.ts  sendForm  — the /api/forms/send trigger. Bundled with a mocked
//      Resend + a fake getDb: proves the form link emails on the 'email' channel,
//      is NOT gated by marketing consent (no consents lookup), and surfaces a
//      provider rejection instead of reporting a phantom success.
//   3. Route wiring (static, the repo's route-guarantee pattern): forms/send,
//      workshops/register, briefing/send route through the shared sender; none gate
//      the transactional send on marketing consent; none drop a failure silently.
//
// Mocks Resend — never sends a live email. Run: node tests/operational-email.test.mjs
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-opemail-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})
const require = createRequire(import.meta.url)

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }
const at = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

// ── Mocked Resend (records every send; never touches the network) ───────────────
// The stub records calls on globalThis so the bundled CJS and this test share state.
globalThis.__resendCalls = []
globalThis.__resendResult = { data: { id: 'mock-email-id' }, error: null }
const resendStub = join(out, 'resend-stub.mjs')
writeFileSync(
  resendStub,
  `export class Resend {
     constructor(key) { this.key = key }
     get emails() {
       return { send: async (args) => { globalThis.__resendCalls.push(args); return globalThis.__resendResult } }
     }
   }
   export default { Resend }`,
)

// A fake Supabase chain sufficient for lib/forms.ts's email path. Every builder method
// returns the chain; terminals resolve deterministically. Crucially it exposes NO
// `consents` behaviour — the test asserts sendForm never queries consent for a
// transactional send. Records the tables touched so the test can prove that.
globalThis.__dbTables = []
const dbStub = join(out, 'db-stub.mjs')
writeFileSync(
  dbStub,
  `export class ConfigError extends Error {}
   export function getBrowserDb() { return getDb() }
   export function getDb() {
     const make = (table) => {
       globalThis.__dbTables.push(table)
       let insertMode = false
       const chain = {
         select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
         limit: () => chain, neq: () => chain, is: () => chain, not: () => chain,
         gte: () => chain, lte: () => chain,
         insert: () => { insertMode = true; return chain },
         update: () => { insertMode = true; return chain },
         maybeSingle: async () => ({ data: null, error: null }),
         single: async () => insertMode
           ? ({ data: { submission_id: 'sub-1' }, error: null })
           : ({ data: null, error: null }),
         then: (resolve) => resolve({ data: null, error: null }),
       }
       return chain
     }
     return { from: (table) => make(table) }
   }`,
)

// esbuild plugin: stub resend + @/lib/supabase/client, resolve every other @/ import
// to the real src file so lib/messaging, lib/tokens, lib/http, lib/compliance are real.
const policyStub = join(out, 'policy-stub.mjs')
writeFileSync(
  policyStub,
  `// Permissive policy stub. This file's subject is the CONTENT and ROUTING of the
   // transactional notifications, not the gate — the gate is proven against the real
   // resolver in tests/guardrail-proof.test.mjs and tests/dispatch-chokepoint.test.mjs,
   // and the per-path declarations are proven in tests/chokepoint-paths.test.mjs.
   export async function resolveDispatchPolicy(ctx) {
     return {
       gate: { allowed: true, escalate: false },
       allowed: true,
       timezone: { resolution: { resolved: true, timeZone: 'America/Chicago', method: 'npa', input: 'stub', approximate: false },
                   zone: 'America/Chicago', localHour: 12, localDay: 3, legacy: true },
       resolved: { memberId: null, householdId: null, agencyId: null, consent: true, onDNC: false, suppressed: undefined },
     }
   }
   export default { resolveDispatchPolicy }`,
)

const stubPlugin = {
  name: 'op-email-stubs',
  setup(b) {
    b.onResolve({ filter: /^resend$/ }, () => ({ path: resendStub }))
    b.onResolve({ filter: /dispatch-policy$/ }, () => ({ path: policyStub }))

    b.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: dbStub }))
    b.onResolve({ filter: /supabase\/client$/ }, () => ({ path: dbStub }))
    b.onResolve({ filter: /^@\// }, (args) => {
      const rel = args.path.slice(2) // drop "@/"
      for (const ext of ['.ts', '.tsx', '/index.ts', '.mjs']) {
        const p = join(root, 'src', rel + ext)
        try { readFileSync(p); return { path: p } } catch { /* try next */ }
      }
      return { path: join(root, 'src', rel + '.ts') }
    })
  },
}

async function bundle(entry) {
  const outfile = join(out, entry.replace(/[\/.]/g, '_') + '.cjs')
  await build({
    entryPoints: [join(root, entry)],
    bundle: true, platform: 'node', format: 'cjs', target: 'node18',
    outfile, logLevel: 'silent', plugins: [stubPlugin],
  })
  return require(outfile)
}

// ── 1. Shared sender: lib/messaging.ts sendEmail (mocked Resend) ────────────────
console.log('\nlib/messaging.ts — shared transactional sender (Resend mocked)')

const messaging = await bundle('src/lib/messaging.ts')

await at('sends on trigger with from/to/subject/html/text + reply-to', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_FROM_EMAIL = 'ops@verified-domain.example'
  process.env.RESEND_REPLY_TO = 'reply@verified-domain.example'
  globalThis.__resendCalls = []
  globalThis.__resendResult = { data: { id: 'mock-email-id' }, error: null }

  const r = await messaging.sendEmail('client@example.com', 'Subject line', '<p>hi</p>', 'hi')
  assert.equal(r.ok, true, 'send reports ok')
  assert.equal(r.id, 'mock-email-id', 'returns provider message id')
  assert.equal(globalThis.__resendCalls.length, 1, 'Resend invoked exactly once')
  const call = globalThis.__resendCalls[0]
  assert.equal(call.from, 'ops@verified-domain.example', 'from = RESEND_FROM_EMAIL (verified domain)')
  assert.equal(call.to, 'client@example.com')
  assert.equal(call.subject, 'Subject line')
  assert.equal(call.html, '<p>hi</p>')
  assert.equal(call.text, 'hi')
  assert.equal(call.replyTo, 'reply@verified-domain.example', 'reply-to routed to monitored inbox')
})

await at('per-send reply-to overrides the env default', async () => {
  globalThis.__resendCalls = []
  await messaging.sendEmail('c@example.com', 's', '<p>b</p>', undefined, { replyTo: 'override@x.example' })
  assert.equal(globalThis.__resendCalls[0].replyTo, 'override@x.example')
})

await at('fails closed when RESEND_FROM_EMAIL is a placeholder — NO Resend call', async () => {
  process.env.RESEND_FROM_EMAIL = 'hello@yourdomain.com'
  globalThis.__resendCalls = []
  const r = await messaging.sendEmail('c@example.com', 's', '<p>b</p>')
  assert.equal(r.ok, false, 'unverified sender is rejected')
  assert.match(r.error || '', /verified sender/i)
  assert.equal(globalThis.__resendCalls.length, 0, 'never calls Resend with an unverified from')
})

await at('fails closed when RESEND_API_KEY is unset — NO Resend call', async () => {
  const saved = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  process.env.RESEND_FROM_EMAIL = 'ops@verified-domain.example'
  globalThis.__resendCalls = []
  const r = await messaging.sendEmail('c@example.com', 's', '<p>b</p>')
  assert.equal(r.ok, false)
  assert.equal(globalThis.__resendCalls.length, 0)
  process.env.RESEND_API_KEY = saved
})

await at('provider rejection is returned, not thrown', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_FROM_EMAIL = 'ops@verified-domain.example'
  globalThis.__resendResult = { data: null, error: { message: 'domain not verified' } }
  const r = await messaging.sendEmail('c@example.com', 's', '<p>b</p>')
  assert.equal(r.ok, false)
  assert.match(r.error || '', /domain not verified/)
  globalThis.__resendResult = { data: { id: 'mock-email-id' }, error: null } // restore
})

// ── 2. Trigger: lib/forms.ts sendForm (mocked Resend + fake DB) ─────────────────
console.log('\nlib/forms.ts — /api/forms/send trigger (Resend mocked, DB faked)')

process.env.RESEND_API_KEY = 'test-key'
process.env.RESEND_FROM_EMAIL = 'ops@verified-domain.example'
const forms = await bundle('src/lib/forms.ts')

await at("emails the secure form link on the 'email' channel trigger", async () => {
  globalThis.__resendCalls = []
  globalThis.__dbTables = []
  globalThis.__resendResult = { data: { id: 'mock-email-id' }, error: null }
  const r = await forms.sendForm({
    form_id: 'financial-needs-analysis',
    channel: 'email',
    email: 'client@example.com',
    client_name: 'Jane',
    customer_id: null,
  })
  assert.equal(r.ok, true, 'sendForm succeeds')
  assert.equal(r.email_sent, true, 'email marked sent')
  assert.equal(globalThis.__resendCalls.length, 1, 'exactly one email sent on trigger')
  assert.equal(globalThis.__resendCalls[0].to, 'client@example.com')
  assert.match(globalThis.__resendCalls[0].subject, /Action Required/)
})

await at('transactional send is NOT gated by marketing consent (no consents lookup)', async () => {
  // The form link is transactional; it must send regardless of marketing consent.
  assert.equal(
    globalThis.__dbTables.includes('consents'),
    false,
    'sendForm never queries the consents table for a transactional send',
  )
})

await at('surfaces a provider rejection instead of a phantom success', async () => {
  globalThis.__resendCalls = []
  globalThis.__resendResult = { data: null, error: { message: 'mailbox rejected' } }
  const r = await forms.sendForm({
    form_id: 'financial-needs-analysis',
    channel: 'email',
    email: 'client@example.com',
    client_name: 'Jane',
    customer_id: null,
  })
  assert.equal(r.email_sent, false, 'not marked sent on rejection')
  assert.match(r.email_error || '', /mailbox rejected/, 'the real reason is surfaced')
  globalThis.__resendResult = { data: { id: 'mock-email-id' }, error: null } // restore
})

// ── 3. Route wiring guarantees (static source assertions) ───────────────────────
console.log('\nRoute wiring — transactional sends route through the shared sender, ungated, never silent')

const read = (rel) => readFileSync(join(root, rel), 'utf8')

t('forms.ts routes email through lib/messaging sendEmail (no direct new Resend)', () => {
  const src = read('src/lib/forms.ts')
  // §11a repair: the import-line regex was satisfiable with the call deleted; the
  // executable call-site anchor is the guarantee.
  assert.ok(/await sendEmail\(/.test(src), 'the executable sendEmail call is present')
  assert.ok(!/new Resend\(/.test(src), 'no direct Resend instantiation remains')
})

t('briefing/send routes through lib/messaging sendEmail (no direct new Resend)', () => {
  const src = read('src/app/api/briefing/send/route.ts')
  assert.ok(/await sendEmail\(/.test(src), 'the executable sendEmail call is present')
  assert.ok(!/new Resend\(/.test(src), 'no direct Resend instantiation remains')
  // Still fails fast on misconfiguration before the (paid) AI call.
  assert.ok(/RESEND_API_KEY is not set|RESEND_FROM_EMAIL is not a verified/.test(src), 'config guard kept')
})

t('legacy /api/workshops/register stays deleted (WS-002 — the gated public route is the only door)', () => {
  assert.ok(!existsSync(join(root, 'src/app/api/workshops/register')), 'legacy unauthenticated register route must not return')
})

t('no operational send gates on the marketing consent table', () => {
  for (const rel of [
    'src/lib/forms.ts',
    'src/app/api/briefing/send/route.ts',
  ]) {
    const src = read(rel)
    // §11a repair: tightened beyond one literal spelling; also ban the consent-gating
    // module imports through which gating would realistically arrive.
    assert.ok(!/\.from\(\s*['\"]consents['\"]\s*\)/.test(src), `${rel} does not read consents for a transactional send`)
    assert.ok(!/@\/lib\/comms\/policy-resolver|@\/lib\/comms\/simulation|@\/lib\/comms\/consent-population/.test(src), `${rel} does not import a consent-gating module`)
  }
})

t('no hardcoded from-address — sendEmail itself resolves RESEND_FROM_EMAIL', () => {
  const msg = read('src/lib/messaging.ts')
  // §11a repair: the token anywhere in the file (e.g. emailConfigured()) satisfied the old
  // regex even with sendEmail hardcoded. Extract sendEmail's function body and assert the
  // env read INSIDE it; extraction failure fails the test (no vacuous fallback).
  const fn = msg.match(/export async function sendEmail\([\s\S]*?\n\}/)
  assert.ok(fn, 'sendEmail function body found')
  assert.ok(/opts\?\.from \|\| process\.env\.RESEND_FROM_EMAIL/.test(fn[0]), 'from resolves env (with per-send override) inside sendEmail itself')
})

console.log(`\n✅ operational-email: ${passed} passed`)
