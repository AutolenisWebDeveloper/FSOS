// Batch 8 — CAPTURED TRANSPORT, the E2E safety mechanism, proven by EXECUTION.
// The Playwright suite's "nothing sends" claim rests entirely on this module, so it is
// proven here rather than assumed: activation rules, the production refusal, the
// JSON-Lines record, and — the one that matters — that a capture-write FAILURE returns
// false so the caller fails the send instead of falling through to a live provider.
// Run: node tests/comms-capture-transport.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
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
  // An unwritable target (a directory, and a read-only dir) makes appendFileSync throw.
  const dir = join(out, 'not-a-file')
  mkdirSync(dir, { recursive: true })
  process.env.COMMS_CAPTURE_TRANSPORT = dir
  ok('a capture write that THROWS returns false (the caller fails the send, per messaging.ts)',
    C.captureMessage({ at: 'now', channel: 'sms', to: '+1', body: 'x' }) === false)

  const roDir = join(out, 'ro')
  mkdirSync(roDir, { recursive: true })
  const roFile = join(roDir, 'cap.jsonl')
  writeFileSync(roFile, '')
  chmodSync(roFile, 0o444)
  process.env.COMMS_CAPTURE_TRANSPORT = roFile
  const wrote = C.captureMessage({ at: 'now', channel: 'email', to: 'a@x.test', body: 'x' })
  // Running as root can bypass file permissions; assert the CONTRACT either way —
  // a successful write is fine, a failed one must report false (never throw, never true).
  ok('a read-only target either captures or reports false — it never throws and never silently "sends"',
    typeof wrote === 'boolean')
  chmodSync(roFile, 0o644)

  delete process.env.COMMS_CAPTURE_TRANSPORT
  ok('with capture INACTIVE the writer reports false (nothing is captured, nothing is claimed)',
    C.captureMessage({ at: 'now', channel: 'sms', to: '+1', body: 'x' }) === false)
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
  const emailIdx = src.indexOf("channel: 'email'")
  const resendIdx = src.indexOf('resend.emails.send')
  ok('the email capture branch precedes the Resend call in source order (it can short-circuit it)',
    emailIdx > 0 && resendIdx > emailIdx)
  const smsIdx = src.indexOf("channel: 'sms', to, body, correlationId")
  // Anchor on the EXECUTABLE fetch, not the string 'api.twilio.com' — that also appears
  // in a comment above the capture branch, and matching it would be the §11a
  // comment-satisfiable defect this suite exists to prevent.
  const twilioIdx = src.indexOf('await fetch(`https://api.twilio.com')
  ok('the SMS capture branch precedes the Twilio fetch CALL in source order',
    smsIdx > 0 && twilioIdx > smsIdx, `smsIdx=${smsIdx} twilioIdx=${twilioIdx}`)
}

console.log(`\n${passed} checks passed.`)
