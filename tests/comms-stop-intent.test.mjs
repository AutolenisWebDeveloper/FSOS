// FSOS-020 — PURE natural-language stop-automation / disinterest detector.
// Proves detectStopAutomation is high-precision: unambiguous stop/decline requests match and
// route to CAMPAIGN TERMINATION, while benign/ambiguous replies and negation homographs do NOT
// (an over-match would terminate a recoverable conversation). Run: node tests/comms-stop-intent.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-stopintent-'))
execSync(
  `npx tsc src/lib/comms/stop-intent.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { detectStopAutomation } = require(join(out, 'stop-intent.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// ── MUST TERMINATE (category B — explicit stop-automation requests) ──────────────
const STOP_REQUESTS = [
  'please stop texting me',
  'Stop contacting me',
  'stop messaging us',
  'pls stop calling',
  'Please stop emailing me',
  'do not text me again',
  "don't contact me",
  'dont call me anymore',
  'quit texting me',
  'no longer contact me',
  'take me off your list',
  'remove me from this list',
  'please remove my number',
  'delete my info',
  'unsubscribe me from these',
  'opt me out',
  'opt out',
  'leave me alone',
  'no more texts please',
  'no further messages',
  "I don't want any more texts",
  'we do not want to be contacted',
  'What is this about? Also please stop texting me.', // stop anywhere in the body
]

console.log('category B — explicit stop-automation requests TERMINATE')
for (const body of STOP_REQUESTS) {
  t(`stop_request: ${JSON.stringify(body)}`, () => {
    const r = detectStopAutomation(body)
    assert.equal(r.matched, true, `expected matched for ${JSON.stringify(body)}`)
    assert.equal(r.kind, 'stop_request')
    assert.ok(r.phrase && r.phrase.length > 0)
  })
}

// ── MUST TERMINATE (category C — clear disinterest) ──────────────────────────────
const DISINTEREST = [
  'not interested',
  'Not interested, thanks',
  "I'm not interested",
  'we are not interested',
  'no longer interested',
  'this is not a good fit',
]
console.log('\ncategory C — clear disinterest TERMINATES')
for (const body of DISINTEREST) {
  t(`disinterest: ${JSON.stringify(body)}`, () => {
    const r = detectStopAutomation(body)
    assert.equal(r.matched, true, `expected matched for ${JSON.stringify(body)}`)
    assert.equal(r.kind, 'disinterest')
  })
}

// ── MUST NOT TERMINATE (category D — benign / ambiguous / negation homographs) ───
const BENIGN = [
  '',
  '   ',
  'Sounds good, what times work?',
  'not right now',
  'not now',
  'not today',
  'not a good time',
  'can we do next week?',
  'call me later',
  "I'm busy this week",
  'maybe later',
  'what would my premium be?',
  'yes please',
  'thanks!',
  'I can stop by your office on Tuesday', // "stop by" is not a cease request
  "I can't stop thinking about this",     // negation homograph
  "I can't stop texting you lol",          // negation homograph (can't stop texting)
  'the non-stop calls from spammers are annoying', // non-stop homograph
  'I never want to stop learning',         // never stop homograph
  'not sure yet',
  'no thanks',                             // intentionally benign (too ambiguous to terminate)
  'is this a good time to talk?',
  'how do I stop by the review?',          // "stop by" again
]
console.log('\ncategory D — benign / ambiguous / negation homographs do NOT terminate')
for (const body of BENIGN) {
  t(`benign: ${JSON.stringify(body)}`, () => {
    const r = detectStopAutomation(body)
    assert.equal(r.matched, false, `expected NO match for ${JSON.stringify(body)}`)
    assert.equal(r.kind, null)
  })
}

console.log(`\nAll ${passed} assertions passed.`)
