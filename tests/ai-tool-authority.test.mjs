// ADR-028 PROOF — model-invokable tools are bound to FSOS's EXISTING per-agent
// green-zone grant and the read-only authority ceiling, and the Zod schema is the
// single source of truth for both the advertised input_schema and fail-closed
// validation. No DB, no provider SDK.
// Run: node tests/ai-tool-authority.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { z } = require('zod')

const out = mkdtempSync(join(tmpdir(), 'fsos-toolauth-'))
// tools.ts's cross-module imports are `import type` (erased) and its `zod` import is
// type-only, so it compiles to a dependency-free module.
execSync(
  `npx tsc src/lib/ai/tools.ts --outDir ${out} --strict --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const { zodTool, zodToJsonSchema, assertToolAuthority, ToolAuthorityError } = require(join(out, 'tools.js'))

const results = []
function t(name, fn) {
  try {
    fn()
    results.push({ name, pass: true })
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ name, pass: false, err: e.message })
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

const readTool = (name, greenZone = 'assemble_data', effect = 'read') =>
  zodTool({
    name,
    description: `${name} tool`,
    effect,
    greenZone,
    schema: z.object({ householdId: z.string(), limit: z.number().optional() }),
    handler: async () => 'ok',
  })

t('zodTool: builds a JSON Schema with correct required/optional fields', () => {
  const tool = readTool('assemble_household')
  assert.equal(tool.jsonSchema.type, 'object')
  assert.deepEqual(tool.jsonSchema.required, ['householdId'])
  assert.equal(tool.jsonSchema.additionalProperties, false)
  assert.equal(tool.jsonSchema.properties.householdId.type, 'string')
  assert.equal(tool.jsonSchema.properties.limit.type, 'number')
})

t('zodTool: validate accepts good input and returns parsed value', () => {
  const tool = readTool('assemble_household')
  const r = tool.validate({ householdId: 'h1' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { householdId: 'h1' })
})

t('zodTool: validate FAILS CLOSED on bad input with a readable error', () => {
  const tool = readTool('assemble_household')
  const r = tool.validate({ limit: 'nope' })
  assert.equal(r.ok, false)
  assert.match(r.error, /householdId/)
})

t('zodToJsonSchema: enums map to a string enum', () => {
  const s = zodToJsonSchema(z.enum(['a', 'b', 'c']))
  assert.equal(s.type, 'string')
  assert.deepEqual(s.enum, ['a', 'b', 'c'])
})

t('zodToJsonSchema: unsupported types throw (no silently-wrong schema)', () => {
  assert.throws(() => zodToJsonSchema(z.date()), /unsupported Zod type/)
})

t('authority: a non-read effect is rejected (v1 ceiling = read only)', () => {
  const write = readTool('advance_stage', 'assemble_data', 'write')
  assert.throws(
    () => assertToolAuthority(['assemble_data'], [write], new Set(['read'])),
    (e) => e instanceof ToolAuthorityError && /exceeds granted authority/.test(e.message),
  )
})

t("authority: a tool outside THIS agent's green-zone set is rejected", () => {
  const tool = readTool('educate_thing', 'educate') // agent below only granted assemble_data
  assert.throws(
    () => assertToolAuthority(['assemble_data', 'identify'], [tool], new Set(['read'])),
    (e) => e instanceof ToolAuthorityError && /not in this agent's roster set/.test(e.message),
  )
})

t('authority: all read tools within the roster set pass', () => {
  const a = readTool('assemble_household', 'assemble_data')
  const b = readTool('find_gaps', 'identify')
  assert.doesNotThrow(() => assertToolAuthority(['assemble_data', 'identify'], [a, b], new Set(['read'])))
})

const failed = results.filter((r) => !r.pass)
if (failed.length) {
  console.error(`\n${failed.length} tool-authority assertion(s) FAILED.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} tool-authority proofs passed (ADR-028).`)
