// Cross-Sell Life (reference) — end-to-end render verification.
// Proves the shared render engine (Increment 0) resolves EVERY merge token the cross-sell
// seed templates reference, through the exact context the send path builds: advisor/agency
// identity + absolute scheduling link (advisorMergeContext) + full_name + the forced email
// unsubscribe link. No cross-sell template can fail-closed-block in production for a missing
// identity/link token, and the delivered body shows the REAL FSA — not a generic default.
// Run: node tests/cross-sell-life-render.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-xsell-render-'))
execSync(
  `npx tsc src/lib/comms/personalize.ts src/lib/site.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { personalize, unresolvedBlockingTokens, tokensIn } = require(join(out, 'comms/personalize.js'))
const { advisorMergeContext, BUSINESS, CONTACT } = require(join(out, 'site.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const SEED = readFileSync('supabase/migrations/086_cross_sell_life_seed.sql', 'utf8')
const seedTokens = [...new Set([...SEED.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase()))]

// The context the send path (sendMessage) builds for a cross-sell EMAIL: identity defaults
// injected, the tick's full_name, and the forced per-recipient absolute unsubscribe link.
const sendCtx = {
  ...advisorMergeContext(),
  full_name: 'Dana Rivers',
  unsubscribe_url: 'https://www.markistfsa.com/unsubscribe?c=dana%40example.com&ch=email',
}

t('the cross-sell seed actually references identity + scheduling tokens (fixture sanity)', () => {
  for (const tok of ['fsa_name', 'agency_name', 'advisor_phone', 'advisor_email', 'scheduling_link', 'first_name']) {
    assert.ok(seedTokens.includes(tok), `expected the cross-sell seed to reference {{${tok}}}`)
  }
})

t('EVERY merge token used across all cross-sell templates resolves in the send-path context', () => {
  const everyToken = seedTokens.map((tok) => `{{${tok}}}`).join(' ')
  const missing = unresolvedBlockingTokens(everyToken, sendCtx)
  assert.deepEqual(missing, [], `cross-sell templates reference unresolved blocking tokens: ${missing.join(', ')}`)
})

t('a representative cross-sell body renders the REAL FSA identity + absolute booking link', () => {
  const body =
    'Hi {{first_name}}, this is {{fsa_name}} with {{agency_name}}. ' +
    'Schedule anytime: {{scheduling_link}} · {{advisor_phone}} · {{advisor_email}}'
  const rendered = personalize(body, sendCtx, { escapeHtml: true })
  assert.doesNotMatch(rendered, /\{\{/, 'a raw {{token}} leaked')
  assert.match(rendered, new RegExp(BUSINESS.agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(rendered, new RegExp(BUSINESS.agency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.ok(rendered.includes(CONTACT.phoneDisplay), 'advisor phone missing')
  assert.ok(rendered.includes(CONTACT.email), 'advisor email missing')
  assert.match(rendered, /Schedule anytime: https:\/\/[^ ]+\/schedule/)
  // Never the pre-Increment-0 generic defaults.
  assert.doesNotMatch(rendered, /your Farmers Financial Services agent|your Farmers agency/)
})

t('an SMS body (no unsubscribe token) still fully resolves identity + scheduling', () => {
  const smsCtx = { ...advisorMergeContext(), full_name: 'Dana Rivers' }
  const body = 'Hi {{first_name}}, {{fsa_name}} here — schedule a review: {{scheduling_link}}. Reply STOP to opt out.'
  assert.deepEqual(unresolvedBlockingTokens(body, smsCtx), [])
  const rendered = personalize(body, smsCtx)
  assert.doesNotMatch(rendered, /\{\{/)
  assert.match(rendered, /https:\/\/[^ ]+\/schedule/)
})

console.log(`\n✓ cross-sell render verification: ${passed} assertions passed`)
