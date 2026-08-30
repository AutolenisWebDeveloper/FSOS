// The E2E safety guard is only worth having if it can FAIL. This proves it does.
//
// tests/e2e/no-live-sends.spec.ts is the assertion that nothing in the browser suite can
// reach a real provider. Its previous version read the TEST RUNNER's environment, which
// the runner itself sets — an assertion that could not fail, certifying every other test.
// That is the §11a false-green pattern sitting in the mechanism that certifies the rest.
//
// So: run THE REAL SPEC, unmodified, against a stub server that reports a chosen capture
// status, and assert the run's exit code. A negative case that fails and a positive
// control that passes together prove the guard is driven by the SERVER's answer.
//
// No Next build and no browser are needed — the guard spec uses the `request` fixture.
// Run: node tests/e2e-guard-falsifiable.test.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'fsos-guard-falsify-'))
process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* best-effort */ } })
const CAPTURE = join(work, 'run.jsonl')

let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  \u2713 ${name}`); passed++ }

// The stub runs as a SEPARATE PROCESS on purpose: the harness drives Playwright with
// execFileSync, which blocks this event loop, so an in-process server could never answer.
const STUB = join(work, 'stub.mjs')
writeFileSync(STUB, `
import { createServer } from 'node:http'
const payload = JSON.parse(process.argv[2])
const status = Number(process.argv[3])
createServer((req, res) => {
  if ((req.url ?? '').startsWith('/api/dev/comms-capture')) {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{"error":"not found"}')
}).listen(Number(process.argv[4]), '127.0.0.1', () => console.log('ready'))
`)

let nextPort = 4550
async function startStub(payload, status) {
  const port = nextPort++
  const child = spawn(process.execPath, [STUB, JSON.stringify(payload), String(status), String(port)], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/dev/comms-capture`)
      await r.text()
      return { child, port }
    } catch {
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  child.kill('SIGKILL')
  throw new Error(`stub on port ${port} never became ready`)
}

/** Run the REAL guard spec against a stub. Returns { code, output }. */
function runGuard(port) {
  try {
    const out = execFileSync(
      'npx',
      ['playwright', 'test', 'tests/e2e/no-live-sends.spec.ts', '--project=desktop', '--reporter=line'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PW_BASE_URL: `http://127.0.0.1:${port}`, COMMS_CAPTURE_TRANSPORT: CAPTURE },
      },
    )
    return { code: 0, output: out }
  } catch (e) {
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

async function withStub(payload, status, fn) {
  const { child, port } = await startStub(payload, status)
  try {
    return fn(port)
  } finally {
    child.kill('SIGKILL')
  }
}

const HEALTHY = { active: true, target: CAPTURE, node_env: 'test', sms_a2p_approved: false }

console.log('POSITIVE CONTROL — a server that reports a correctly captured transport')
{
  const r = await withStub(HEALTHY, 200, runGuard)
  ok('the guard PASSES against a healthy server (so a failure below is the flag, not a broken harness)',
    r.code === 0, r.output)
}

console.log('\nNEGATIVE — capture OFF on the server: the guard MUST fail')
{
  const r = await withStub({ ...HEALTHY, active: false, target: null }, 200, runGuard)
  ok('the guard FAILS when the server reports capture inactive', r.code !== 0, r.output)
  ok('…and says so — the failure names the real problem, not an incidental crash',
    /captured transport active|would reach a real provider/i.test(r.output), r.output)
}

console.log('\nNEGATIVE — a PRODUCTION build (endpoint 404s, capture cannot activate there)')
{
  const r = await withStub({ error: 'Not found' }, 404, runGuard)
  ok('the guard FAILS when the endpoint is absent', r.code !== 0, r.output)
  ok('…and names the production-build cause', /PRODUCTION build/i.test(r.output), r.output)
}

console.log('\nNEGATIVE — the server captures to a DIFFERENT file than this run configured')
{
  const r = await withStub({ ...HEALTHY, target: '/tmp/some-other-run.jsonl' }, 200, runGuard)
  ok('the guard FAILS on a capture-target mismatch (a run cannot read another run\'s evidence)',
    r.code !== 0, r.output)
}

console.log('\nNEGATIVE — the A2P backstop disarmed IN THE SERVER PROCESS')
{
  const r = await withStub({ ...HEALTHY, sms_a2p_approved: true }, 200, runGuard)
  ok('the guard FAILS when the server has SMS_A2P_APPROVED truthy', r.code !== 0, r.output)
}

console.log('\nThe guard reads the SERVER, not the runner')
{
  // The decisive check: the runner's own env is set to the healthy value in BOTH runs
  // above and below (runGuard always exports COMMS_CAPTURE_TRANSPORT=CAPTURE). The only
  // thing that changed in the failing runs is what the SERVER said.
  const raw = readFileSync(join(root, 'tests/e2e/no-live-sends.spec.ts'), 'utf8')
  // Strip comments FIRST. The spec's own header explains the runner-env mistake by
  // naming it, and matching that prose would be the §11a comment-satisfiable defect —
  // here in its inverted form, a false RED. Only executable code may satisfy this.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  ok('no EXECUTABLE line reads process.env.COMMS_CAPTURE_TRANSPORT (the runner-side value it used to trust)',
    !/process\.env\.COMMS_CAPTURE_TRANSPORT/.test(code),
    (code.match(/.*COMMS_CAPTURE_TRANSPORT.*/g) ?? []).join('\n'))
  ok('the spec fetches the server status endpoint',
    /request\.get\('\/api\/dev\/comms-capture'\)/.test(code))
  ok('the record check reads the file the SERVER named (status.target), not a runner path',
    /const target = status\.target as string/.test(code) && /existsSync\(target\)/.test(code))
}

console.log(`\n${passed} checks passed.`)
