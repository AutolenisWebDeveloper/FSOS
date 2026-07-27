// Transactional notification proof (contact / workshop / booking intake).
//
// Scope: the EVENT-TRIGGERED transactional sends added to fix the "no emails" outage —
//   1. lib/notifications/transactional.ts — the shared visitor-ack + FSA-alert helpers.
//      Proven against a MOCKED Resend: they send to the right inbox with escaped HTML,
//      resolve the FSA inbox with the documented precedence, route reply-to, and FAIL
//      CLOSED (no Resend call) when email is not configured.
//   2. Route wiring (static): the three public intake routes actually call the helpers,
//      and none gates the transactional send on the marketing `consents` table.
//
// Mocks Resend — never sends a live email. Run: node tests/transactional-notifications.test.mjs
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-notify-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})
const require = createRequire(import.meta.url)

let passed = 0
const at = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// ── Mocked Resend (records every send; never touches the network) ───────────────
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

const stubPlugin = {
  name: 'notify-stubs',
  setup(b) {
    b.onResolve({ filter: /^resend$/ }, () => ({ path: resendStub }))
    b.onResolve({ filter: /^@\// }, (args) => {
      const rel = args.path.slice(2)
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

console.log('\nlib/notifications/transactional.ts — shared transactional sends (Resend mocked)')
const notify = await bundle('src/lib/notifications/transactional.ts')

await at('FSA inbox resolves env → reply-to → CONTACT.email (precedence)', async () => {
  process.env.FSOS_NOTIFY_EMAIL = 'leads@fsa.example'
  assert.equal(notify.fsaNotificationInbox(), 'leads@fsa.example', 'FSOS_NOTIFY_EMAIL wins')
  delete process.env.FSOS_NOTIFY_EMAIL
  process.env.RESEND_REPLY_TO = 'reply@fsa.example'
  assert.equal(notify.fsaNotificationInbox(), 'reply@fsa.example', 'falls back to RESEND_REPLY_TO')
  delete process.env.RESEND_REPLY_TO
  assert.match(notify.fsaNotificationInbox(), /@/, 'falls back to a real CONTACT.email default')
})

await at('notifyFsa sends to the FSA inbox with subject/html/text + reply-to', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_FROM_EMAIL = 'ops@verified.example'
  process.env.FSOS_NOTIFY_EMAIL = 'leads@fsa.example'
  globalThis.__resendCalls = []
  globalThis.__resendResult = { data: { id: 'mock-email-id' }, error: null }
  const r = await notify.notifyFsa({
    subject: 'New lead — Jane Doe',
    heading: 'New consultation request',
    lede: 'A new lead came in.',
    rows: [{ label: 'Email', value: 'jane@example.com' }],
    replyTo: 'jane@example.com',
  })
  assert.equal(r.ok, true)
  assert.equal(globalThis.__resendCalls.length, 1, 'Resend invoked exactly once')
  const call = globalThis.__resendCalls[0]
  assert.equal(call.to, 'leads@fsa.example', 'sent to the resolved FSA inbox')
  assert.equal(call.from, 'ops@verified.example')
  assert.match(call.subject, /New lead/)
  assert.ok(call.html.includes('jane@example.com'), 'detail rows rendered in HTML')
  assert.ok(typeof call.text === 'string' && call.text.length > 0, 'plaintext part present')
  assert.equal(call.replyTo, 'jane@example.com', 'reply-to routes the FSA reply to the lead')
})

await at('recipient-controlled values are HTML-escaped (XSS defense)', async () => {
  globalThis.__resendCalls = []
  await notify.notifyFsa({
    subject: 'New lead',
    heading: 'New consultation request',
    lede: 'A new lead came in.',
    rows: [{ label: 'Name', value: '<script>alert(1)</script>' }],
  })
  const html = globalThis.__resendCalls[0].html
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag never reaches the HTML')
  assert.ok(html.includes('&lt;script&gt;'), 'the value is HTML-escaped')
})

await at('sendVisitorAck sends to the visitor; reply-to defaults to the FSA inbox', async () => {
  process.env.FSOS_NOTIFY_EMAIL = 'leads@fsa.example'
  globalThis.__resendCalls = []
  const r = await notify.sendVisitorAck({
    to: 'jane@example.com',
    subject: 'We received your request',
    heading: 'Thanks for reaching out.',
    lede: 'We will respond soon.',
  })
  assert.equal(r.ok, true)
  const call = globalThis.__resendCalls[0]
  assert.equal(call.to, 'jane@example.com', 'sent to the visitor')
  assert.equal(call.replyTo, 'leads@fsa.example', 'reply-to defaults to the FSA inbox')
})

await at('fails closed when email is not configured — NO Resend call', async () => {
  const savedKey = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  globalThis.__resendCalls = []
  const a = await notify.notifyFsa({ subject: 's', heading: 'h', lede: 'l' })
  const b = await notify.sendVisitorAck({ to: 'jane@example.com', subject: 's', heading: 'h', lede: 'l' })
  assert.equal(a.ok, false)
  assert.equal(b.ok, false)
  assert.equal(globalThis.__resendCalls.length, 0, 'never calls Resend when unconfigured')
  process.env.RESEND_API_KEY = savedKey
})

await at('placeholder RESEND_FROM_EMAIL fails closed — NO Resend call', async () => {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_FROM_EMAIL = 'hello@yourdomain.com'
  globalThis.__resendCalls = []
  const r = await notify.notifyFsa({ subject: 's', heading: 'h', lede: 'l' })
  assert.equal(r.ok, false)
  assert.equal(globalThis.__resendCalls.length, 0)
  process.env.RESEND_FROM_EMAIL = 'ops@verified.example'
})

// ── Route wiring (static source assertions) ─────────────────────────────────────
console.log('\nRoute wiring — public intake routes trigger the transactional sends')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

t('contact route sends a visitor ack + FSA alert', () => {
  const src = read('src/app/api/public/contact/route.ts')
  assert.ok(/from '@\/lib\/notifications\/transactional'/.test(src), 'imports the shared helpers')
  assert.ok(/sendVisitorAck\(/.test(src), 'acknowledges the visitor')
  assert.ok(/notifyFsa\(/.test(src), 'alerts the FSA')
})

t('workshop public register route sends a visitor ack + FSA alert', () => {
  const src = read('src/app/api/public/workshops/register/route.ts')
  assert.ok(/from '@\/lib\/notifications\/transactional'/.test(src), 'imports the shared helpers')
  assert.ok(/sendVisitorAck\(/.test(src), 'acknowledges the registrant')
  assert.ok(/notifyFsa\(/.test(src), 'alerts the FSA')
})

t('booking service alerts the FSA and falls back to a transactional booker confirmation', () => {
  const src = read('src/lib/booking/book.ts')
  assert.ok(/from '@\/lib\/notifications\/transactional'/.test(src), 'imports the shared helpers')
  assert.ok(/notifyFsa\(/.test(src), 'alerts the FSA on every booking')
  assert.ok(/sendVisitorAck\(/.test(src), 'has a transactional booker fallback')
  assert.ok(/sendBookingConfirmation\(/.test(src), 'still attempts the templated confirmation first')
})

t('no transactional intake send gates on the marketing consent table', () => {
  for (const rel of [
    'src/lib/notifications/transactional.ts',
    'src/app/api/public/contact/route.ts',
    'src/app/api/public/workshops/register/route.ts',
  ]) {
    const src = read(rel)
    assert.ok(!/\.from\('consents'\)/.test(src), `${rel} does not read consents for a transactional send`)
  }
})

console.log(`\n✅ transactional-notifications: ${passed} passed`)
