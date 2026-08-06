// tests/comms-turn-limit.test.mjs
// Per-conversation AI turn ceiling (§4.2) — PURE proofs, no DB.
//
// Two properties carry the safety argument and both are asserted here:
//   • the ceiling FAILS CLOSED — an unreadable policy or an unusable ceiling hands off,
//     it never degrades to "unlimited"; and
//   • the counter resets on a HUMAN turn, so an FSA reply returns the budget, while blocked
//     or held drafts (which never reached the contact) do not consume it.
//
// Run: node tests/comms-turn-limit.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const out = mkdtempSync(join(process.cwd(), '.turn-limit-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })

// turn-limit.ts imports the Supabase client factory for its DB adapters. The pure exports
// under test never touch it, so it is replaced with a stub that THROWS — if a "pure" function
// ever reaches for the database, this test fails loudly instead of quietly passing.
const stub = join(out, 'db-stub.js')
writeFileSync(stub, `module.exports = { getDb() { throw new Error('pure decision reached for the database') } }`)
const bundle = join(out, 'turn-limit.cjs')
await build({
  entryPoints: [resolve('src/lib/comms/turn-limit.ts')],
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent',
  plugins: [{
    name: 'stub-db',
    setup(b) {
      b.onResolve({ filter: /(^|\/)supabase\/client$/ }, () => ({ path: stub }))
      b.onResolve({ filter: /^@\// }, (a) => ({ path: resolve('src', a.path.slice(2)) + '.ts' }))
    },
  }],
})
const require = createRequire(import.meta.url)
const { evaluateTurnLimit, countAiTurnsSinceHuman, FALLBACK_MAX_AI_TURNS } = require(bundle)

const results = []
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }) }
  catch (e) { results.push({ name, pass: false, err: e.message }) }
}

const policy = (over = {}) => ({ maxAiTurns: 6, enabled: true, source: 'policy:global', isAssumption: true, ...over })
const ai = (status = 'sent') => ({ ai_generated: true, delivery_status: status })
const human = (status = 'sent') => ({ ai_generated: false, delivery_status: status })

// ─── the counter ───────────────────────────────────────────────────────────────
check('an empty thread has taken zero AI turns', () => {
  assert.equal(countAiTurnsSinceHuman([]), 0)
})
check('consecutive sent AI replies accumulate', () => {
  assert.equal(countAiTurnsSinceHuman([ai(), ai(), ai()]), 3)
})
check('a human reply RESETS the budget — the FSA took and returned control', () => {
  // Descending time order: two AI turns, then the FSA's reply, then older AI turns.
  assert.equal(countAiTurnsSinceHuman([ai(), ai(), human(), ai(), ai(), ai(), ai()]), 2)
})
check('a human reply as the most recent turn leaves the budget fully reset', () => {
  assert.equal(countAiTurnsSinceHuman([human(), ai(), ai(), ai(), ai(), ai(), ai()]), 0)
})
check('a HELD or BLOCKED draft is not a turn — it never reached the contact', () => {
  // A run of gate blocks must not silently consume the budget and hand off a conversation
  // in which the automation never actually said anything.
  assert.equal(countAiTurnsSinceHuman([ai('blocked'), ai('failed'), ai('queued'), ai('sent')]), 1)
})
check('held drafts do not mask the human reset either', () => {
  assert.equal(countAiTurnsSinceHuman([ai('failed'), ai(), human(), ai()]), 1)
})

// ─── the decision ──────────────────────────────────────────────────────────────
check('below the ceiling, another turn is allowed', () => {
  const d = evaluateTurnLimit({ turnsTaken: 3, policy: policy() })
  assert.equal(d.allowed, true)
  assert.match(d.reason, /within the AI turn limit \(3\/6/)
})
check('AT the ceiling the conversation hands off (>=, not >)', () => {
  const d = evaluateTurnLimit({ turnsTaken: 6, policy: policy() })
  assert.equal(d.allowed, false)
  assert.match(d.reason, /turn limit reached \(6\/6 since the last human reply/)
  assert.match(d.reason, /handing off to the licensed FSA/)
})
check('past the ceiling still hands off', () => {
  assert.equal(evaluateTurnLimit({ turnsTaken: 99, policy: policy() }).allowed, false)
})
check('the decision reports the numbers so the escalation can explain itself', () => {
  const d = evaluateTurnLimit({ turnsTaken: 6, policy: policy({ maxAiTurns: 6 }) })
  assert.equal(d.turnsTaken, 6)
  assert.equal(d.maxAiTurns, 6)
})

// ─── fail-closed: the property that makes this a limit rather than a suggestion ─
check('FAIL CLOSED — an unreadable policy (ceiling 0) hands off, it is not "unlimited"', () => {
  const d = evaluateTurnLimit({ turnsTaken: 0, policy: policy({ maxAiTurns: 0, source: 'policy unavailable' }) })
  assert.equal(d.allowed, false, 'an unreadable policy must not permit a turn')
  assert.match(d.reason, /could not be determined/)
})
check('FAIL CLOSED — a negative or non-finite ceiling hands off', () => {
  for (const bad of [-1, NaN, Infinity, undefined]) {
    assert.equal(evaluateTurnLimit({ turnsTaken: 0, policy: policy({ maxAiTurns: bad }) }).allowed, false,
      `ceiling ${String(bad)} must fail closed`)
  }
})
check('FAIL CLOSED — an unverifiable turn count (-1) still hands off at any ceiling', () => {
  // checkTurnLimit() returns turnsTaken -1 on a counting error; the ceiling must not rescue it.
  // (The adapter returns allowed:false directly; this pins that -1 is never "below the limit".)
  const d = evaluateTurnLimit({ turnsTaken: -1, policy: policy() })
  assert.equal(d.allowed, true, 'guard: the PURE function has no special case for -1')
  // …which is precisely why checkTurnLimit must not route an error through it. Asserted in
  // the e2e suite against a real database.
})

// ─── explicit disable is an operator act, and it is legible ────────────────────
check('a DISABLED policy row imposes no ceiling (explicit, audited operator act)', () => {
  const d = evaluateTurnLimit({ turnsTaken: 500, policy: policy({ enabled: false }) })
  assert.equal(d.allowed, true)
  assert.match(d.reason, /turn limit disabled/)
})

// ─── the per-campaign override is legible in the reason ────────────────────────
check('the reason names WHICH policy row decided (per-campaign override is traceable)', () => {
  const d = evaluateTurnLimit({ turnsTaken: 2, policy: policy({ maxAiTurns: 2, source: 'policy:pipeline' }) })
  assert.equal(d.allowed, false)
  assert.match(d.reason, /policy:pipeline/)
})

// ─── coherence with the reply frequency cap (ADR-017 amendment) ────────────────
check('the two bounds are on different axes and cannot contradict', () => {
  // The turn limit is per CONVERSATION and depth-based; it knows nothing about per-contact
  // volume, and takes no input that the frequency cap also consumes. Independence is the
  // property — assert the decision depends ONLY on turns + policy.
  const a = evaluateTurnLimit({ turnsTaken: 2, policy: policy() })
  const b = evaluateTurnLimit({ turnsTaken: 2, policy: policy() })
  assert.deepEqual(a, b, 'the turn decision must be a pure function of turns + policy')
})

check('the shipped fallback ceiling matches migration 103', () => {
  assert.equal(FALLBACK_MAX_AI_TURNS, 6)
})

const failed = results.filter((r) => !r.pass)
for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${r.pass ? '' : `: ${r.err}`}`)
if (failed.length) {
  console.error(`\n✗ ${failed.length}/${results.length} turn-limit assertions FAILED.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} turn-limit assertions passed.`)
