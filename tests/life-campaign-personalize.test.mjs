// Life Conversion Campaign — merge tokens. The §14 copy needs scheduling_link, advisor_phone,
// and advisor_email in addition to the existing name/agency tokens. This proves the shared
// personalize() resolves them from context and falls back to a SAFE neutral (never a raw
// "{{token}}" leaking to a contact) — extended additively, existing tokens unchanged.
// Run: node tests/life-campaign-personalize.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-lcc-pers-'))
execSync(
  `npx tsc src/lib/comms/personalize.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
// personalize.ts now imports ../variables → ../../site, so tsc infers rootDir=src/lib and
// emits under comms/ (site.js at the root). Require from the emitted subpath accordingly.
const { personalize, unresolvedBlockingTokens } = require(join(out, 'comms/personalize.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('resolves the campaign contact tokens from context', () => {
  const ctx = {
    first_name: 'Dana',
    fsa_name: 'Markist',
    agency_name: 'McKinney Farmers',
    scheduling_link: 'https://book.example/dana',
    advisor_phone: '(555) 111-2222',
    advisor_email: 'markist@example.com',
  }
  const body = 'Hi {{first_name}}, {{fsa_name}} at {{agency_name}}. Book: {{scheduling_link}} · {{advisor_phone}} · {{advisor_email}}'
  assert.equal(
    personalize(body, ctx),
    'Hi Dana, Markist at McKinney Farmers. Book: https://book.example/dana · (555) 111-2222 · markist@example.com',
  )
})

t('a missing scheduling link FAILS CLOSED (blocking token, never a raw token or relative link)', () => {
  // Fail-closed contract: scheduling_link is a blocking-tier token. When unresolved it is
  // FLAGGED (so the send path blocks + escalates) and never rendered as a raw {{token}} or a
  // relative "/schedule" link (relative links break in a delivered email).
  assert.deepEqual(unresolvedBlockingTokens('Schedule: {{scheduling_link}}', {}), ['scheduling_link'])
  assert.ok(!personalize('Schedule: {{scheduling_link}}', {}).includes('{{'), 'raw token leaked')
})

t('a RELATIVE scheduling link is unresolved (absolute-URL enforcement)', () => {
  assert.deepEqual(unresolvedBlockingTokens('{{scheduling_link}}', { scheduling_link: '/schedule' }), ['scheduling_link'])
  assert.deepEqual(unresolvedBlockingTokens('{{scheduling_link}}', { scheduling_link: 'https://x/y' }), [])
})

t('missing advisor identity FAILS CLOSED (blocking tokens flagged, never a raw token)', () => {
  const missing = unresolvedBlockingTokens('Call {{advisor_phone}} or {{advisor_email}} — {{fsa_name}} at {{agency_name}}', {})
  for (const tok of ['advisor_phone', 'advisor_email', 'fsa_name', 'agency_name']) {
    assert.ok(missing.includes(tok), `expected ${tok} flagged unresolved`)
  }
  assert.ok(!personalize('Call {{advisor_phone}}', {}).includes('{{'), 'raw token leaked')
})

t('existing tokens are unchanged (regression)', () => {
  assert.equal(personalize('Hi {{first_name}}', { first_name: 'Sam' }), 'Hi Sam')
  assert.equal(personalize('Hi {{first_name}}', {}), 'Hi there')
})

console.log(`\n✓ life-campaign personalize: ${passed} assertions passed`)
