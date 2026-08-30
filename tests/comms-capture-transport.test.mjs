// CAPTURED TRANSPORT, the E2E safety mechanism, proven by EXECUTION:
// activation rules, the production refusal, the JSON-Lines record, and — the one that
// matters — that a capture-write FAILURE returns false so the caller fails the send
// instead of falling through to a live provider.
//
// ── WHAT THIS FILE DOES NOT COVER, and why it matters ───────────────────────────
// It compiles capture-transport.ts with BARE tsc and tests SOURCE SEMANTICS. That is
// not the artifact that ships. Next runs the same source through webpack's DefinePlugin,
// which inlines process.env.NODE_ENV at build time; in a production build the minifier
// then constant-folds the production refusal and the whole function collapses:
//
//     function e(){return process.env.COMMS_CAPTURE_TRANSPORT,null}
//
// So in a `next build` artifact captureTarget() is unconditionally null and capture is
// structurally absent. That is the production refusal working as designed — but it is
// invisible from here, and this file's green result is exactly what made the Batch 8
// E2E "nothing sends" claim look proven while the mechanism was inert under `next start`.
// The ARTIFACT-level property is asserted elsewhere, at runtime, over HTTP:
// tests/e2e/no-live-sends.spec.ts reads the server's own /api/dev/comms-capture, and
// tests/e2e-guard-falsifiable.test.mjs proves that guard fails when it should.
// Run: node tests/comms-capture-transport.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-capture-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })

let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

execSync(
  `npx tsc src/lib/comms/capture-transport.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
  { cwd: root, stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const C = require(join(out, 'capture-transport.js'))

const savedVar = process.env.COMMS_CAPTURE_TRANSPORT
const savedEnv = process.env.NODE_ENV
const restore = () => {
  if (savedVar === undefined) delete process.env.COMMS_CAPTURE_TRANSPORT
  else process.env.COMMS_CAPTURE_TRANSPORT = savedVar
  if (savedEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = savedEnv
}
process.on('exit', restore)

console.log('Activation rules')
{
  delete process.env.COMMS_CAPTURE_TRANSPORT
  process.env.NODE_ENV = 'test'
  ok('inactive with no env var — the real provider path is untouched by default',
    C.captureActive() === false && C.captureTarget() === null)

  const file = join(out, 'cap.jsonl')
  process.env.COMMS_CAPTURE_TRANSPORT = file
  ok('active when the env var names a file', C.captureActive() === true && C.captureTarget() === file)

  process.env.NODE_ENV = 'production'
  ok('REFUSES to activate in production even with the var set (a stray env cannot silence prod sends)',
    C.captureActive() === false && C.captureTarget() === null)
  process.env.NODE_ENV = 'test'
}

console.log('The captured record')
{
  const file = join(out, 'record.jsonl')
  process.env.COMMS_CAPTURE_TRANSPORT = file
  ok('an email capture returns true', C.captureMessage({
    at: '2026-08-29T12:00:00.000Z', channel: 'email', to: 'a@x.test',
    subject: 'You are registered', body: '<p>hi</p>', bodyText: 'hi', attachments: ['workshop.ics'],
  }) === true)
  ok('an SMS capture returns true', C.captureMessage({
    at: '2026-08-29T12:00:01.000Z', channel: 'sms', to: '+12145550188', body: 'Reminder',
  }) === true)

  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '')
  ok('both landed as JSON Lines (one parseable record per send)', lines.length === 2)
  const email = JSON.parse(lines[0])
  ok('the email record carries channel/to/subject/body/text and the ATTACHMENT NAME only',
    email.channel === 'email' && email.to === 'a@x.test' && email.subject === 'You are registered' &&
      email.body === '<p>hi</p>' && email.bodyText === 'hi' &&
      JSON.stringify(email.attachments) === JSON.stringify(['workshop.ics']),
    lines[0])
  const sms = JSON.parse(lines[1])
  ok('the SMS record carries channel/to/body', sms.channel === 'sms' && sms.to === '+12145550188' && sms.body === 'Reminder')
}

console.log('Fail CLOSED — a broken capture must never become a live send')
{
  // The contract has TWO halves and both are asserted exactly: a failed write returns
  // FALSE and leaves nothing behind; a successful write returns TRUE and the line lands.
  // The previous version of this block used a chmod 0444 file and asserted only
  // `typeof wrote === 'boolean'` — which passes for true AND false, i.e. it could not
  // tell "captured" from "failed", the one distinction the block exists to make. The
  // failure modes below are chosen because ROOT CANNOT BYPASS THEM: a missing parent
  // directory is ENOENT and a directory target is EISDIR regardless of privilege.
  const msg = { at: 'now', channel: 'sms', to: '+12145550100', body: 'x' }

  const dir = join(out, 'not-a-file')
  mkdirSync(dir, { recursive: true })
  process.env.COMMS_CAPTURE_TRANSPORT = dir
  ok('a directory target (EISDIR) returns EXACTLY false — never true, never a throw',
    C.captureMessage(msg) === false)

  const orphan = join(out, 'no-such-dir', 'deeper', 'cap.jsonl')
  process.env.COMMS_CAPTURE_TRANSPORT = orphan
  ok('a missing parent directory (ENOENT) returns EXACTLY false',
    C.captureMessage(msg) === false)
  ok('…and nothing was created on the way past — a failed capture leaves NO evidence',
    !existsSync(orphan) && !existsSync(join(out, 'no-such-dir')))

  // POSITIVE CONTROL on the same assertion, so `false` above is a real decision rather
  // than a writer that always refuses.
  const good = join(out, 'faildemo-ok.jsonl')
  process.env.COMMS_CAPTURE_TRANSPORT = good
  ok('POSITIVE CONTROL: a writable target returns EXACTLY true…', C.captureMessage(msg) === true)
  ok('…and the message is IN the file (returning true always means the line landed)',
    existsSync(good) && JSON.parse(readFileSync(good, 'utf8').trim()).to === '+12145550100')

  delete process.env.COMMS_CAPTURE_TRANSPORT
  ok('with capture INACTIVE the writer reports false (nothing is captured, nothing is claimed)',
    C.captureMessage(msg) === false)
}

console.log('The product wiring (messaging.ts) uses it at the provider boundary')
{
  const src = readFileSync(join(root, 'src/lib/messaging.ts'), 'utf8')
  // Executable anchors: the capture branch must RETURN before the provider call, and a
  // failed capture must return an error — not fall through.
  ok('the email path returns a captured result and errors on a failed write, before Resend',
    /captureMessage\(\{[\s\S]*?channel: 'email'[\s\S]*?\}\)\s*\n\s*return ok \? \{ ok: true, id: `captured_/.test(src) &&
      /capture_write_failed/.test(src))
  ok('the SMS path does the same before the Twilio fetch',
    /captureMessage\(\{ at: new Date\(\)\.toISOString\(\), channel: 'sms'/.test(src) &&
      /return ok \? \{ ok: true, id: `SMcaptured/.test(src))
  ok('both capture hooks sit INSIDE the delivery seam, so policy + gate + quiet hours still run above them',
    /async deliverEmail\(\{[\s\S]{0,600}?captureActive\(\)/.test(src) &&
      /async deliverSms\(\{[\s\S]{0,600}?captureActive\(\)/.test(src))
  const emailIdx = src.indexOf("channel: 'email'")
  const resendIdx = src.indexOf('resend.emails.send')
  ok('the email capture branch precedes the Resend call in source order (it can short-circuit it)',
    emailIdx > 0 && resendIdx > emailIdx)
  // Re-anchored for main's refactor: the provider call moved into the `deliverSms` seam
  // of MessagingDeps, whose args carry no correlationId (it reaches Twilio inside the
  // statusCallback URL instead), so the capture record no longer carries one either. The
  // ordering property this asserts is unchanged.
  const smsIdx = src.indexOf("channel: 'sms', to, body })")
  // Anchor on the EXECUTABLE fetch, not the string 'api.twilio.com' — that also appears
  // in a comment above the capture branch, and matching it would be the §11a
  // comment-satisfiable defect this suite exists to prevent.
  const twilioIdx = src.indexOf('await fetch(`https://api.twilio.com')
  ok('the SMS capture branch precedes the Twilio fetch CALL in source order',
    smsIdx > 0 && twilioIdx > smsIdx, `smsIdx=${smsIdx} twilioIdx=${twilioIdx}`)
}

console.log(`\n${passed} checks passed.`)
