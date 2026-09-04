// Proof that the Claude Code enforcement layer actually enforces.
//
// CLAUDE.md's "never run X" lines are prose, and prose can be ignored. The parts that
// cannot be ignored are .claude/settings.json's deny rules and .claude/hooks/block-danger.sh.
// An UNENFORCED control is worse than no control, because you rely on it — so the guard is
// tested here rather than trusted.
//
// Two failure directions matter equally:
//   - a destructive action that is NOT blocked  -> the guard is decorative
//   - a legitimate action that IS blocked       -> the guard makes the repo unworkable,
//                                                  and will be disabled by whoever hits it
// Run: node tests/claude-hooks-guard.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const HOOK = '.claude/hooks/block-danger.sh'
const SETTINGS = '.claude/settings.json'
const BLOCK = 2 // PreToolUse: exit 2 denies the tool call

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`) }
  catch (err) { failures++; console.log(`  ✗ ${label}\n      ${err.message}`) }
}

// Run the hook with a synthetic PreToolUse payload and return its exit code.
function run(payload) {
  try {
    execFileSync('bash', [HOOK], { input: JSON.stringify(payload), stdio: ['pipe', 'pipe', 'pipe'] })
    return 0
  } catch (err) {
    return typeof err.status === 'number' ? err.status : -1
  }
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })
const edit = (file_path) => ({ tool_name: 'Edit', tool_input: { file_path } })
const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } })

console.log('Enforcement layer is installed')
check('block-danger.sh exists and is executable', () => {
  assert.ok(existsSync(HOOK), `${HOOK} is missing`)
  assert.ok(statSync(HOOK).mode & 0o111, `${HOOK} is not executable`)
})
check('settings.json registers the PreToolUse guard', () => {
  const s = JSON.parse(readFileSync(SETTINGS, 'utf8'))
  const cmds = (s.hooks?.PreToolUse ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command))
  assert.ok(cmds.some((c) => c.includes('block-danger.sh')),
    'no PreToolUse hook points at block-danger.sh — the guard would never run')
})
check('settings.json keeps the Supabase write denials', () => {
  const s = JSON.parse(readFileSync(SETTINGS, 'utf8'))
  const deny = s.permissions?.deny ?? []
  for (const rule of ['mcp__Supabase__apply_migration', 'mcp__Supabase__deploy_edge_function']) {
    assert.ok(deny.includes(rule), `deny rule removed: ${rule}`)
  }
})

console.log('\nDestructive actions are BLOCKED')
const mustBlock = [
  ['recursive force delete',        bash('rm -rf /tmp/x')],
  ['... buried mid-pipeline',       bash('cd /tmp && rm -rf build')],
  ['... inside bash -c',            bash('bash -c "rm -rf /tmp/y"')],
  ['git reset --hard',              bash('git reset --hard HEAD~3')],
  ['git push --force',              bash('git push --force origin main')],
  ['git clean -fd',                 bash('git clean -fd')],
  ['drop database',                 bash('psql -c "drop database fsos"')],
  ['truncate table',                bash('psql -c "truncate table contacts"')],
  ['supabase db push',              bash('supabase db push')],
  ['reading a .env secret',         bash('cat .env.local')],
  ['writing a .env secret',         write('.env.local')],
  ['hand-editing the lockfile',     edit('package-lock.json')],
]
for (const [label, payload] of mustBlock) {
  check(label, () => assert.equal(run(payload), BLOCK, 'was NOT blocked'))
}

check('editing an EXISTING migration', () => {
  const existing = execFileSync('bash', ['-c', 'ls supabase/migrations/*.sql | head -1'], { encoding: 'utf8' }).trim()
  assert.ok(existing, 'no migrations found to test against')
  assert.equal(run(edit(existing)), BLOCK, `editing ${existing} was NOT blocked`)
})

console.log('\nLegitimate work is ALLOWED (a guard that blocks real work gets switched off)')
const mustAllow = [
  ['adding a NEW migration',        write('supabase/migrations/999_new_thing.sql')],
  ['editing .env.local.example',    write('.env.local.example')],
  ['editing a source file',         edit('src/lib/http.ts')],
  ['npm run build',                 bash('npm run build')],
  ['npm test',                      bash('npm test')],
  ['git status',                    bash('git status --short')],
  ['a normal git push',             bash('git push -u origin my-branch')],
  ['git clean -n (dry run)',        bash('git clean -n')],
  ['removing a single file',        bash('rm /tmp/scratch.txt')],
  // A doc that NAMES a forbidden command is data, not an execution of it. Without this,
  // the guard blocks anyone writing CLAUDE.md's own "never run" list.
  ['a heredoc that names them',     bash('cat > d.md <<EOF\nNever run: rm -rf or git clean -fd.\nEOF')],
]
for (const [label, payload] of mustAllow) {
  check(label, () => assert.equal(run(payload), 0, 'was blocked but should be allowed'))
}

console.log('\nMalformed input fails OPEN (a crashing guard must not halt all work)')
for (const [label, input] of [['empty stdin', ''], ['non-JSON stdin', 'not json at all']]) {
  check(label, () => {
    let code
    try { execFileSync('bash', [HOOK], { input, stdio: ['pipe', 'pipe', 'pipe'] }); code = 0 }
    catch (err) { code = err.status }
    assert.equal(code, 0, 'guard blocked on malformed input')
  })
}

assert.equal(failures, 0, `${failures} enforcement check(s) failed`)
console.log(`\nOK — Claude Code enforcement layer verified (${mustBlock.length + mustAllow.length + 5} checks).`)
