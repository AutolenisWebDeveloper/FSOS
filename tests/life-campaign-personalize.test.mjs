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
const { personalize } = require(join(out, 'personalize.js'))

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

t('falls back to a safe neutral for a missing scheduling link (never a raw token)', () => {
  const out = personalize('Schedule: {{scheduling_link}}', {})
  assert.ok(!out.includes('{{'), 'raw token leaked')
  assert.ok(out.length > 'Schedule: '.length, 'expected a non-empty fallback link')
})

t('missing advisor phone/email resolve to empty, not a raw token', () => {
  assert.equal(personalize('Call {{advisor_phone}} or {{advisor_email}}', {}), 'Call  or ')
})

t('existing tokens are unchanged (regression)', () => {
  assert.equal(personalize('Hi {{first_name}}', { first_name: 'Sam' }), 'Hi Sam')
  assert.equal(personalize('Hi {{first_name}}', {}), 'Hi there')
})

console.log(`\n✓ life-campaign personalize: ${passed} assertions passed`)
