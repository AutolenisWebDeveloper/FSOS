// FSOS-030 security guard — the Twilio status callback trusts the `?mid=` correlation key ONLY
// because verifyTwilioSignature signs the FULL StatusCallback URL, INCLUDING its query string.
// If requestUrl() ever stopped including the query, `mid` would become attacker-controllable
// (a forged request could advance an arbitrary message's lifecycle). This locks the property:
// requestUrl MUST include the query string. Run: node tests/comms-twilio-requesturl.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-twilio-url-'))
execSync(
  `npx tsc src/lib/comms/twilio.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { requestUrl } = require(join(out, 'twilio.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('requestUrl includes the query string (so the signature covers ?mid=)', () => {
  const url = requestUrl({
    url: 'https://app.example.test/api/webhooks/twilio/status?mid=abc-123',
    headers: new Headers(),
  })
  assert.ok(url.includes('mid=abc-123'), `signed URL must include the mid query param; got ${url}`)
})

t('requestUrl honors x-forwarded-host/proto AND keeps the query', () => {
  const url = requestUrl({
    url: 'http://localhost/api/webhooks/twilio/status?mid=xyz',
    headers: new Headers({ 'x-forwarded-host': 'app.example.test', 'x-forwarded-proto': 'https' }),
  })
  assert.equal(url, 'https://app.example.test/api/webhooks/twilio/status?mid=xyz')
})

t('no query → URL still resolves (no trailing ?)', () => {
  const url = requestUrl({
    url: 'https://app.example.test/api/webhooks/twilio/status',
    headers: new Headers({ host: 'app.example.test' }),
  })
  assert.equal(url, 'https://app.example.test/api/webhooks/twilio/status')
})

console.log(`\nAll ${passed} assertions passed.`)
