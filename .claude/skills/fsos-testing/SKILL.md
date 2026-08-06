---
name: fsos-testing
description: Write a test that FSOS's runner will actually discover and execute. Use this whenever a task adds, changes, debugs, or reviews anything under tests/, whenever you are about to write a failing test first (CLAUDE.md §8 step 4), whenever `npm run test` or `npm run test:rls` behaves unexpectedly, and whenever a change touches RLS, the securities firewall, the AI red line, consent/quiet-hours, or any other guardrail whose proof lives in tests/. Reach for it even when the user just says "add a test for this", "why did the suite pass without running my test", "how do I test this service", or "make this provable" — because FSOS has NO test framework and the correct file shape is not inferable from the repo. Not for deciding WHAT to test (CLAUDE.md §13.13 governs that) — this is HOW.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: testing
  governs: "HOW tests are written and discovered. WHAT must be tested is CLAUDE.md §13.13."
---

# FSOS Testing

**FSOS has no test framework.** No Jest, no Vitest, no Mocha — and *not* `node:test`
either. Zero of the 166 files under `tests/` import `node:test`; zero use
`describe`/`it`. Reaching for any of them produces a file the runner will happily
execute and that will silently assert nothing, or a file that fails for reasons
unrelated to the code under test.

A test is a **bare executable Node script** that asserts with `node:assert/strict`
and exits non-zero on failure. That is the whole contract.

Read this before writing anything under `tests/`. `CLAUDE.md` §13.13 governs *what*
must be tested and states that a legitimate guardrail test may never be weakened,
skipped, or rewritten to green a build — that rule is binding and is not restated
here.

## Discovery — you do not register a test

`scripts/run-tests.mjs` does `readdirSync('tests')` and selects every `*.mjs` and
`*.mts` file. **Do not edit `package.json` to add a test.** Drop the file in
`tests/` and it runs.

Consequences worth internalizing:

- A test placed anywhere else — `src/**/__tests__`, `*.test.ts` beside the source,
  a `tests/` subdirectory — is **never discovered**. The suite goes green and your
  test did not run. This is the single most common way to ship an unproven change.
- The runner only recurses zero levels. `tests/foo/bar.test.mjs` is invisible.
- Naming: use `<subject>.test.mjs`. The `.test` infix is convention, not a filter —
  discovery is by extension alone — but keep it, since every existing file has it.

Confirm what will run before you trust a green suite:

```bash
node scripts/run-tests.mjs unit --list   # 158 files
node scripts/run-tests.mjs rls  --list   # 11 files
```

## The two sets

| Set | Command | Files | Needs |
|---|---|---|---|
| `unit` | `npm run test` | 158 | nothing beyond Node + `npx` |
| `rls` | `npm run test:rls` | 11 | a **root-owned Postgres**, run under sudo |

The `rls` set is an explicit allowlist hard-coded in `scripts/run-tests.mjs`. Its
members stand up an ephemeral database with `initdb`, `pg_ctl` and
`runuser -u postgres`, apply real migrations, and assert as a non-privileged role.
Everything not on that list is `unit`.

**Choosing the set is a decision, not a formality:**

- Needs a real Postgres to prove the claim (an RLS policy actually hides a row, a
  unique index actually prevents a double-booking, a migration actually backfills)
  → add the filename to the `RLS` set in `scripts/run-tests.mjs` in the same change.
  Forget this and it runs in the default set without sudo and fails as if broken.
- Everything else → leave it out. Adding a non-Postgres test to the `RLS` set
  **removes it from the default run**, so it stops gating ordinary work. Both
  misfilings are silent.

The runner continues past failures deliberately (it does not `&&`-chain), so one
run surfaces every failing file. Exit code is non-zero iff any selected file failed.

## The runtime-`tsc` pattern — the thing you will not guess

136 of 166 test files **shell out to `npx tsc` at runtime**, compiling a named set
of TypeScript sources into a temp directory, then `require` the emitted JS. This is
how FSOS proves pure logic — gate evaluation, eligibility, formulas, state machines —
without a live Supabase, a clock, or network.

```js
// Run: node tests/example.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-example-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch {} })

execSync(
  `npx tsc src/lib/comms/gate.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const { evaluateGate } = require(join(out, 'comms/gate.js'))
```

Rules that follow from it:

- **Compile only what you need.** List the entry file(s); `tsc` pulls their imports.
  A module that reaches `getDb()`, `next/server`, or an env var at import time will
  drag the world in and fail — which is why the architecture keeps decision cores
  pure and adapters thin. If your target won't compile standalone, that is usually
  a design signal, not a test problem.
- **The output path mirrors the source path minus `src/lib/`.** `src/lib/comms/gate.ts`
  emits at `<out>/comms/gate.js`. Multi-entry compiles change the emitted root — check
  the temp dir if a `require` misses.
- `--skipLibCheck --esModuleInterop` are load-bearing; keep the flag set as written.
  Add `--strict` when the file under test is strict-clean (some tests do).
- Clean up via `process.on('exit', ...)` (32 files do). Best-effort, never throwing.

## Assertions and the local `t()` convention

`node:assert/strict` only — used by 159 of 166 files. There is no test registry, so
124 files define a three-line local harness at the top:

```js
let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('recommendation language is BLOCKED (the red line)', () => {
  const r = validateAIClientMessage('You should buy this annuity now.', ctx)
  assert.equal(r.allow, false)
  assert.ok(r.reasons.includes('recommendation'))
})

console.log(`\nAll ${passed} assertions passed.`)
```

`t()` is intentionally not a framework: it does not catch. A throwing assert
propagates, the process exits non-zero, and the runner records the file as failed.
That is the entire failure mechanism. 43 files additionally call `process.exit(1)`
explicitly after printing a diagnostic — do that when you want a readable report
before the exit rather than a raw `AssertionError`.

Because there is no reporter, **`console.log` is the output contract.** Print a
header naming the invariant and a `✓` per assertion; end with a summary line. A
silent test that passes is indistinguishable from a test that asserted nothing.

## Conventions to match

- **Header comment, then `// Run:`.** 100 of the 166 carry an explicit run line
  (`// Run: node tests/x.test.mjs`, or `npx tsx` for `.mts`). Say what invariant the
  file proves and cite the governing ADR or `CLAUDE.md` section — several guardrail
  tests name the ADR they are the proof of.
- **`.mts` when you want types.** 3 files are TypeScript; the runner executes them
  via `npx tsx` instead of `node`. Same assertions, same conventions.
- **`fast-check` is available** (dev dependency, `^3.23.2`) for property tests.
  Currently used by `tests/fna-engine.test.mjs` for the deterministic engine —
  the right tool for pure formula and money math, not for I/O paths.
- **Skip cleanly, never falsely pass.** 12 files detect a missing prerequisite (no
  Postgres binary, unset env) and exit 0 with a printed SKIPPED line. Do this only
  for genuinely environmental gaps, and make the skip loud.
- **Determinism.** No wall-clock, no RNG, no network in a `unit` test. Pass
  `computedAt` and fixtures in; the pure cores are designed to accept them.

## Worked example — starting from scratch

1. Identify the **pure core** to prove. If the logic lives in a route handler,
   it is in the wrong layer (`CLAUDE.md` §3.1.8) — move it to a service first.
2. Create `tests/<subject>.test.mjs` with the header + `// Run:` line.
3. Compile the core into a temp dir with the `tsc` block above, or import directly
   if it is already `.mjs`-compatible.
4. Write `t()` cases covering the happy path **and** the failure paths §13.13 names
   — authorization, guardrail blocks, invalid state transitions.
5. `node tests/<subject>.test.mjs` — watch it fail first (§8 step 4).
6. Implement. Re-run until green.
7. If it needed a real Postgres, add the filename to the `RLS` set in
   `scripts/run-tests.mjs`.
8. `node scripts/run-tests.mjs unit --list | grep <subject>` to confirm discovery.
9. `npm run test` before claiming done.

## Reference

- Runner: `scripts/run-tests.mjs` (discovery + the `RLS` allowlist).
- Pure-core + `tsc` exemplar: `tests/guardrail.test.mjs`, `tests/gdc-tier.test.mjs`.
- Root-Postgres exemplar: `tests/rls-firewall.test.mjs`.
- Static-invariant exemplar (an architectural rule enforced as a test):
  `tests/ai-gateway-seam.test.mjs`.
- Property-test exemplar: `tests/fna-engine.test.mjs`.
- `.mts` exemplar: `tests/import-mapping-model.test.mts`.
- **What to test, and the rule against weakening a guardrail test: `CLAUDE.md` §13.13.**
