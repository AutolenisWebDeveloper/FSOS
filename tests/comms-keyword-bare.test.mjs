// Inbound keyword classification: STOP keeps the broad first-word match (an opt-out must never
// be missed), but an opt-IN or HELP counts only as a BARE keyword. A genuine reply that merely
// starts with "Yes", "Help" or "Info" must fall through to normal reply handling so it pauses
// promotional automation and reaches the FSA (audit B-02 / B-03; owner decision 4).
// Run: node tests/comms-keyword-bare.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-kw-bare-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
execSync(`npx tsc src/lib/comms/keywords.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`, { stdio: 'inherit' })
const require = createRequire(import.meta.url)
const { classifyKeyword } = require(join(out, 'keywords.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }
console.log('Inbound keywords: bare opt-in / help, broad STOP')
t('STOP still matches the first word', () => {
  for (const b of ['STOP', 'stop please', 'Stop.', 'cancel my texts', 'UNSUBSCRIBE']) assert.equal(classifyKeyword(b), 'stop', b)
})
t('a bare opt-in keyword is an opt-in', () => {
  for (const b of ['START', 'yes', 'Yes!', ' unstop ', 'SUBSCRIBE']) assert.equal(classifyKeyword(b), 'start', b)
})
t('a reply that starts with yes/start is a message', () => {
  for (const b of ['Yes, Tuesday works', 'yes please call me', 'Start date is Monday']) assert.equal(classifyKeyword(b), 'message', b)
})
t('a bare HELP / INFO is help', () => {
  for (const b of ['HELP', 'help?', 'Info']) assert.equal(classifyKeyword(b), 'help', b)
})
t('a reply that starts with help/info is a message (pauses + escalates)', () => {
  for (const b of ['Help me understand my renewal', 'info on the review please']) assert.equal(classifyKeyword(b), 'message', b)
})
console.log(`\nAll ${passed} assertions passed.`)
