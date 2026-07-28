// ADR-028 PROOF — the governed agent tool-calling loop enforces its guarantees
// with NO provider SDK and NO Supabase (pure core). Every invariant that keeps a
// model-driven loop safe in a regulated system is asserted here:
//   1. authority ceiling  — a tool outside allowedEffects is refused before the loop
//   2. allowlist          — an ungranted tool name is never executed
//   3. fail-safe validate — invalid input never reaches the handler
//   4. bounded            — the loop stops at maxIterations
//   5. interruptible      — a throwing beforeTurn (kill switch) halts immediately
//   +  usage accounting accumulates across turns; handler output flows back.
// Run: node tests/ai-tool-loop.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-toolloop-'))
execSync(
  `npx tsc src/lib/ai/tool-loop.ts --outDir ${out} --strict --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { driveToolLoop, ToolAuthorityError } = require(join(out, 'tool-loop.js'))

const results = []
async function t(name, fn) {
  try {
    await fn()
    results.push({ name, pass: true })
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ name, pass: false, err: e.message })
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

const usage = { inputTokens: 1, outputTokens: 1 }

// A read-only tool that records whether its handler ran.
function readTool(name, { validateOk = true, ran } = {}) {
  return {
    name,
    description: `${name} tool`,
    effect: 'read',
    jsonSchema: { type: 'object' },
    validate: (input) => (validateOk ? { ok: true, value: input } : { ok: false, error: 'bad input' }),
    handler: async (input) => {
      if (ran) ran.push({ name, input })
      return `result:${name}`
    },
  }
}

// A scripted model: emits the queued turns in order, then a plain-text stop turn.
function scriptedModel(turns) {
  let i = 0
  return async () => {
    if (i < turns.length) {
      const spec = turns[i++]
      const toolUses = spec.toolUses ?? []
      return {
        assistant: {
          role: 'assistant',
          content: [
            ...(spec.text ? [{ type: 'text', text: spec.text }] : []),
            ...toolUses.map((u) => ({ type: 'tool_use', id: u.id, name: u.name, input: u.input })),
          ],
        },
        toolUses,
        text: spec.text ?? '',
        usage,
      }
    }
    return { assistant: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, toolUses: [], text: 'done', usage }
  }
}

await t('authority ceiling: a non-read tool is refused before the loop runs', async () => {
  const ran = []
  const writeTool = { ...readTool('advance_stage', { ran }), effect: 'write' }
  await assert.rejects(
    () =>
      driveToolLoop(scriptedModel([]), [writeTool], {
        initialMessages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        allowedEffects: new Set(['read']),
      }),
    (e) => e instanceof ToolAuthorityError,
  )
  assert.equal(ran.length, 0, 'handler must never run when the ceiling rejects the tool')
})

await t('happy path: a granted read tool runs and its output returns to the model', async () => {
  const ran = []
  const tool = readTool('assemble_data', { ran })
  const model = scriptedModel([{ toolUses: [{ id: 'a1', name: 'assemble_data', input: { q: 1 } }] }])
  const res = await driveToolLoop(model, [tool], {
    initialMessages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    allowedEffects: new Set(['read']),
  })
  assert.equal(ran.length, 1)
  assert.equal(res.calls.length, 1)
  assert.equal(res.calls[0].status, 'ok')
  assert.equal(res.calls[0].output, 'result:assemble_data')
  assert.equal(res.stopped, 'stop')
  assert.equal(res.text, 'done')
})

await t('allowlist: an ungranted tool name is recorded rejected and never executed', async () => {
  const ran = []
  const tool = readTool('assemble_data', { ran })
  // Model asks for a tool that was NOT provided.
  const model = scriptedModel([{ toolUses: [{ id: 'x1', name: 'delete_everything', input: {} }] }])
  const res = await driveToolLoop(model, [tool], {
    initialMessages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    allowedEffects: new Set(['read']),
  })
  assert.equal(ran.length, 0, 'no handler should run')
  assert.equal(res.calls[0].status, 'rejected')
  // The refusal is fed back as an error tool_result so the model can recover.
  const lastUser = res.messages.filter((m) => m.role === 'user').pop()
  assert.ok(lastUser.content.some((b) => b.type === 'tool_result' && b.isError))
})

await t('fail-safe: invalid input is refused and the handler never runs', async () => {
  const ran = []
  const tool = readTool('assemble_data', { validateOk: false, ran })
  const model = scriptedModel([{ toolUses: [{ id: 'b1', name: 'assemble_data', input: { junk: true } }] }])
  const res = await driveToolLoop(model, [tool], {
    initialMessages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    allowedEffects: new Set(['read']),
  })
  assert.equal(ran.length, 0, 'invalid input must never reach the handler (§11.1 fail-safe)')
  assert.equal(res.calls[0].status, 'invalid')
  assert.match(res.calls[0].detail, /bad input/)
})

await t('bounded: an endlessly-tool-calling model stops at maxIterations', async () => {
  const ran = []
  const tool = readTool('assemble_data', { ran })
  // Model always asks for the tool again — never stops on its own.
  const model = async () => ({
    assistant: { role: 'assistant', content: [{ type: 'tool_use', id: 'loop', name: 'assemble_data', input: {} }] },
    toolUses: [{ id: 'loop', name: 'assemble_data', input: {} }],
    text: '',
    usage,
  })
  const res = await driveToolLoop(model, [tool], {
    initialMessages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    allowedEffects: new Set(['read']),
    maxIterations: 3,
  })
  assert.equal(res.iterations, 3)
  assert.equal(res.stopped, 'max_iterations')
  assert.equal(ran.length, 3, 'exactly maxIterations executions, no more')
})

await t('interruptible: a throwing beforeTurn (kill switch) halts immediately', async () => {
  const ran = []
  const tool = readTool('assemble_data', { ran })
  const model = scriptedModel([{ toolUses: [{ id: 'k1', name: 'assemble_data', input: {} }] }])
  await assert.rejects(
    () =>
      driveToolLoop(model, [tool], {
        initialMessages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        allowedEffects: new Set(['read']),
        beforeTurn: async () => {
          throw new Error('AI gateway disabled by kill switch (global).')
        },
      }),
    /kill switch/,
  )
  assert.equal(ran.length, 0, 'no tool runs once the kill switch fires')
})

await t('usage accounting accumulates across every model turn', async () => {
  const tool = readTool('assemble_data')
  // Two tool turns then a stop turn = 3 model calls, each usage {1,1}.
  const model = scriptedModel([
    { toolUses: [{ id: 'u1', name: 'assemble_data', input: {} }] },
    { toolUses: [{ id: 'u2', name: 'assemble_data', input: {} }] },
  ])
  const res = await driveToolLoop(model, [tool], {
    initialMessages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    allowedEffects: new Set(['read']),
  })
  assert.equal(res.usage.inputTokens, 3)
  assert.equal(res.usage.outputTokens, 3)
})

const failed = results.filter((r) => !r.pass)
if (failed.length) {
  console.error(`\n${failed.length} tool-loop assertion(s) FAILED.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} tool-loop governance proofs passed (ADR-028).`)
