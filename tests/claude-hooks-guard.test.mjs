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
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const require$ = createRequire(import.meta.url)

// Anchor to the repo, not the CWD. Run from elsewhere and every path lookup fails, which
// this test would otherwise report as "was NOT blocked" — a guard failure that isn't one.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(REPO)

const HOOK = join(REPO, '.claude/hooks/block-danger.sh')
const SETTINGS = join(REPO, '.claude/settings.json')
const BLOCK = 2 // PreToolUse: exit 2 denies the tool call

let failures = 0
let ran = 0
const check = (label, fn) => {
  ran++
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
check('settings.json registers the PreToolUse guard on every mutating tool', () => {
  const s = JSON.parse(readFileSync(SETTINGS, 'utf8'))
  const entry = (s.hooks?.PreToolUse ?? []).find((e) =>
    (e.hooks ?? []).some((h) => (h.command ?? '').includes('block-danger.sh')))
  assert.ok(entry, 'no PreToolUse hook points at block-danger.sh — the guard would never run')
  // run() below drives the hook directly, so it cannot notice a narrowed matcher. Narrowing
  // this to "Bash" would silently disable every Edit/Write rule in production.
  for (const tool of ['Bash', 'Edit', 'Write', 'NotebookEdit']) {
    assert.ok((entry.matcher ?? '').includes(tool),
      `PreToolUse matcher does not cover ${tool}: ${entry.matcher}`)
  }
})
check('settings.json keeps the Supabase write denials', () => {
  const deny = JSON.parse(readFileSync(SETTINGS, 'utf8')).permissions?.deny ?? []
  for (const rule of ['mcp__Supabase__apply_migration', 'mcp__Supabase__deploy_edge_function']) {
    assert.ok(deny.includes(rule), `deny rule removed: ${rule}`)
  }
})
check('settings.json keeps the destructive-command deny rules', () => {
  // The declarative layer is what the hook's own header calls PRIMARY. Assert it by shape,
  // so deleting the Bash/Read/Edit rules fails here instead of passing quietly.
  const deny = JSON.parse(readFileSync(SETTINGS, 'utf8')).permissions?.deny ?? []
  const has = (re) => deny.some((r) => re.test(r))
  for (const [label, re] of [
    ['rm -rf', /^Bash\(rm -[rRfF]/],
    ['git reset --hard', /^Bash\(git reset --hard/],
    ['force push', /^Bash\(git push --force/],
    ['git clean', /^Bash\(git clean -/],
    ['supabase db push', /^Bash\(supabase db push/],
    ['.env read', /^Read\(\.\/\.env/],
    ['.env edit', /^Edit\(\.\/\.env/],
  ]) {
    assert.ok(has(re), `no deny rule covering ${label}`)
  }
  assert.ok(deny.filter((r) => r.startsWith('Bash(')).length >= 10,
    `Bash deny rules look gutted: ${deny.filter((r) => r.startsWith('Bash(')).length}`)
})

console.log('\nDestructive actions are BLOCKED')
const mustBlock = [
  ['recursive force delete',        bash('rm -rf /tmp/x')],
  ['... buried mid-pipeline',       bash('cd /tmp && rm -rf build')],
  ['... inside bash -c',            bash('bash -c "rm -rf /tmp/y"')],
  ['... behind an env assignment',  bash('FOO=bar rm -rf /tmp/z')],
  ['... via xargs',                 bash('echo x | xargs rm -rf')],
  // Spelling variants. A substring scan for the literal "rm -rf" misses every one of these.
  ['rm -Rf (capital R)',            bash('rm -Rf /tmp/x')],
  ['rm --recursive --force',        bash('rm --recursive --force /tmp/x')],
  ['rm -r without -f',              bash('rm -r /tmp/tree')],
  ['find -delete',                  bash('find . -delete')],
  ['find -exec rm',                 bash('find src -exec rm {} ;')],
  ['git reset --hard',              bash('git reset --hard HEAD~3')],
  // `git -C <dir>` breaks the adjacency any substring rule depends on.
  ['git -C dir reset --hard',       bash('git -C /tmp/x reset --hard HEAD~5')],
  ['git -C dir clean -fdx',         bash('git -C /tmp/x clean -fdx')],
  ['git push --force',              bash('git push --force origin main')],
  ['git push ... --force (suffix)', bash('git push origin main --force')],
  ['git clean -fd',                 bash('git clean -fd')],
  ['git checkout -- .',             bash('git checkout -- .')],
  ['git restore --worktree .',      bash('git restore --staged --worktree .')],
  ['git stash clear',               bash('git stash clear')],
  ['drop database',                 bash('psql -c "drop database fsos"')],
  ['truncate table',                bash('psql -c "truncate table contacts"')],
  ['supabase db push',              bash('supabase db push')],
  // `supabase` is not on PATH and is not a project dependency, so npx IS the real invocation.
  // Without a package-runner arm the rule above never fires in practice.
  ['npx supabase db push',          bash('npx supabase db push')],
  ['npx -y supabase link',          bash('npx -y supabase link --project-ref abc')],
  ['pnpm dlx supabase db reset',    bash('pnpm dlx supabase db reset')],
  ['reading a .env secret',         bash('cat .env.local')],
  ['reading .env by full path',     bash('cat /home/user/FSOS/.env')],
  // A literal `<<` inside a quoted string or a comment must not be read as a heredoc opener.
  // It used to set a bogus terminator, which blanked every following line before scanning —
  // so a destructive command on line 2 went unseen. Under-scanning is the dangerous direction.
  ['<< in a quoted string',         bash('echo "shift: a << b"\nrm -rf /tmp/x')],
  ['<< in a comment',               bash('# shift left << two\nrm -rf /tmp/x')],
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
  ['git clean -nd (dry run)',       bash('git clean -nd')],
  ['git clean --dry-run',           bash('git clean --dry-run')],
  ['removing a single file',        bash('rm /tmp/scratch.txt')],
  ['git diff',                      bash('git diff --stat')],
  ['npx tsc',                       bash('npx tsc --noEmit')],
  ['npx tsx (how .mts run)',        bash('npx tsx tests/foo.test.mts')],
  ['pnpm install',                  bash('pnpm install')],
  ['chained add + commit',          bash('git add -A && git commit -m wip')],
  // Commands that merely NAME a forbidden command are data, not an execution of it. A
  // substring scan blocks all of these, and a guard that blocks real work gets switched off.
  ['grep for a forbidden string',   bash('grep -rn "rm -rf" docs/')],
  ['a commit message naming one',   bash('git commit -m "fix: guard against rm -rf"')],
  ['echoing one',                   bash('echo "never run git push --force"')],
  ['git log --grep for one',        bash('git log --grep="git push --force"')],
  ['reading .env.local.example',    bash('cat .env.local.example')],
  ['a heredoc that names them',     bash('cat > d.md <<EOF\nNever run: rm -rf or git clean -fd.\nEOF')],
  // A herestring is not a heredoc. Mis-parsing `<<<` as one made the guard drop every later
  // line, which would HIDE a real destructive command rather than merely over-block.
  ['herestring, then safe cmd',     bash('grep -q x <<< "hello world"\nnpm run build')],
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

// ---------------------------------------------------------------------------------------
// The Stop gate under an abrupt kill. Two properties, both learned the hard way:
//   1. It must not ORPHAN the typecheck. A hook cancelled at its timeout takes no trap with
//      it, so a naively-spawned `tsc` is reparented to init and burns CPU for its full 240s.
//      Repeated cancellations stacked them.
//   2. The dirty marker must SURVIVE. An earlier version consumed it before running tsc, so
//      a cancelled run destroyed the marker and skipped the typecheck permanently — the gate
//      silently disarmed itself.
console.log('\nStop gate survives cancellation without orphaning, lying, or disarming itself')
// Four properties, each of which was broken at some point and each of which matters:
//   orphan   - a cancelled hook must not leave `tsc` running (it burned CPU for up to 240s)
//   marker   - it must SURVIVE, or the gate silently skips the typecheck from then on
//   block    - a cancelled run must not emit a fabricated "TYPECHECK FAILED"
//   stderr   - job-control noise must not be fed back to Claude as if it were tsc output
// SIGTERM/SIGHUP are the modes that were broken: the trap killed the WATCHDOG rather than the
// typecheck, then fell through and read the signal status as a type-check result.
for (const signal of ['KILL', 'TERM', 'HUP']) {
  check(`SIG${signal} on the hook: no orphan, marker kept, no false block`, () => {
    const os = require$('node:os'), fs = require$('node:fs'), pathMod = require$('node:path')
    const root = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'fsos-gate-'))
    const proj = pathMod.join(root, 'proj')
    const tmp = pathMod.join(root, 'tmp')
    const bin = pathMod.join(root, 'bin')
    const pidFile = pathMod.join(root, 'child.pid')
    const hookPid = pathMod.join(root, 'hook.pid')
    const errFile = pathMod.join(root, 'hook.err')
    fs.mkdirSync(pathMod.join(proj, 'node_modules', 'typescript'), { recursive: true })
    fs.mkdirSync(tmp); fs.mkdirSync(bin)
    fs.writeFileSync(pathMod.join(bin, 'npx'), `#!/bin/sh\necho $$ > ${pidFile}\nexec sleep 30\n`)
    fs.chmodSync(pathMod.join(bin, 'npx'), 0o755)
    // `setsid` forks, so $! is the short-lived setsid, not the hook. An exec wrapper records
    // the real pid — without this the test kills nothing and passes vacuously.
    const launcher = pathMod.join(root, 'launch.sh')
    fs.writeFileSync(launcher,
      `echo $$ > ${hookPid}\nexec bash ${pathMod.join(REPO, '.claude/hooks/done-gate.sh')}\n`)

    const key = execFileSync('bash', ['-c', `printf '%s' "${proj}" | cksum | cut -d' ' -f1`],
      { encoding: 'utf8' }).trim()
    const marker = pathMod.join(tmp, `fsos-claude-ts-dirty-${key}`)
    fs.writeFileSync(marker, 'x.ts\n')

    execFileSync('bash', ['-c', `
      setsid env TMPDIR=${tmp} PATH=${bin}:$PATH CLAUDE_PROJECT_DIR=${proj} \
        bash ${launcher} </dev/null >/dev/null 2>${errFile} &
      sleep 2
      kill -${signal} "$(cat ${hookPid})" 2>/dev/null
      sleep 5`], { encoding: 'utf8', timeout: 40000 })

    assert.ok(fs.existsSync(pidFile), 'the stubbed typecheck never started')
    const childPid = Number(fs.readFileSync(pidFile, 'utf8').trim())
    let alive = true
    try { process.kill(childPid, 0) } catch { alive = false }
    if (alive) { try { process.kill(childPid, 'SIGKILL') } catch {} }
    assert.equal(alive, false, `typecheck pid ${childPid} was ORPHANED by the SIG${signal}ed gate`)

    assert.ok(fs.existsSync(marker),
      `SIG${signal} destroyed the dirty marker — the typecheck would be skipped from now on`)

    const err = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : ''
    assert.ok(!err.includes('TYPECHECK FAILED'),
      `SIG${signal} produced a fabricated block; stderr was:\n${err}`)
    assert.ok(!/while kill|ticks=|timeout 240 npx/.test(err),
      `job-control noise leaked the hook's own source into stderr:\n${err}`)
    fs.rmSync(root, { recursive: true, force: true })
  })
}

check('killing only the watchdog does not fake a block or destroy the marker', () => {
  // The watchdog is a single point of failure: if it dies while the hook lives, `wait`
  // returns a SIGNAL status. Read as a typecheck result that becomes a fabricated
  // "TYPECHECK FAILED" plus a consumed marker — the gate lying and disarming itself at once.
  const os = require$('node:os'), fs = require$('node:fs'), pathMod = require$('node:path')
  const root = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'fsos-wd-'))
  const proj = pathMod.join(root, 'proj'), tmp = pathMod.join(root, 'tmp'), bin = pathMod.join(root, 'bin')
  const hookPid = pathMod.join(root, 'hook.pid'), errFile = pathMod.join(root, 'e.txt')
  fs.mkdirSync(pathMod.join(proj, 'node_modules', 'typescript'), { recursive: true })
  fs.mkdirSync(tmp); fs.mkdirSync(bin)
  fs.writeFileSync(pathMod.join(bin, 'npx'), '#!/bin/sh\nexec sleep 20\n')
  fs.chmodSync(pathMod.join(bin, 'npx'), 0o755)
  const launcher = pathMod.join(root, 'launch.sh')
  fs.writeFileSync(launcher,
    `echo $$ > ${hookPid}\nexec bash ${pathMod.join(REPO, '.claude/hooks/done-gate.sh')}\n`)
  const key = execFileSync('bash', ['-c', `printf '%s' "${proj}" | cksum | cut -d' ' -f1`],
    { encoding: 'utf8' }).trim()
  const marker = pathMod.join(tmp, `fsos-claude-ts-dirty-${key}`)
  fs.writeFileSync(marker, 'x.ts\n')

  execFileSync('bash', ['-c', `
    setsid env TMPDIR=${tmp} PATH=${bin}:$PATH CLAUDE_PROJECT_DIR=${proj} \
      bash ${launcher} </dev/null >/dev/null 2>${errFile} &
    sleep 2
    hp="$(cat ${hookPid})"
    wd="$(pgrep -P "$hp" | head -1)"
    [ -n "$wd" ] && kill -9 "$wd"
    sleep 3
    kill -9 "$hp" 2>/dev/null; true`], { encoding: 'utf8', timeout: 40000 })

  const err = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : ''
  assert.ok(!err.includes('TYPECHECK FAILED'),
    `a dead watchdog produced a fabricated block; stderr was:\n${err}`)
  assert.ok(fs.existsSync(marker),
    'a dead watchdog caused the marker to be consumed — the gate disarmed itself')
  fs.rmSync(root, { recursive: true, force: true })
})

console.log('\nStop gate still does its actual job (an orphan test alone can pass vacuously)')
// The orphan checks above all pass if the gate kills the typecheck INSTANTLY and never
// blocks — which is exactly the regression a subtle liveness bug produced. These pin the
// behaviour the gate exists for, so "no orphan" can never be satisfied by doing nothing.
const gateSandbox = (npxBody) => {
  const os = require$('node:os'), fs = require$('node:fs'), pathMod = require$('node:path')
  const root = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'fsos-fn-'))
  const proj = pathMod.join(root, 'proj'), tmp = pathMod.join(root, 'tmp'), bin = pathMod.join(root, 'bin')
  fs.mkdirSync(pathMod.join(proj, 'node_modules', 'typescript'), { recursive: true })
  fs.mkdirSync(tmp); fs.mkdirSync(bin)
  fs.writeFileSync(pathMod.join(bin, 'npx'), `#!/bin/bash\n${npxBody}\n`)
  fs.chmodSync(pathMod.join(bin, 'npx'), 0o755)
  const key = execFileSync('bash', ['-c', `printf '%s' "${proj}" | cksum | cut -d' ' -f1`],
    { encoding: 'utf8' }).trim()
  const marker = pathMod.join(tmp, `fsos-claude-ts-dirty-${key}`)
  const run = () => {
    fs.writeFileSync(marker, 'x.ts\n')
    const err = pathMod.join(root, 'e.txt')
    let code = 0
    try {
      execFileSync('bash', ['-c',
        `TMPDIR=${tmp} PATH=${bin}:$PATH CLAUDE_PROJECT_DIR=${proj} ` +
        `bash ${pathMod.join(REPO, '.claude/hooks/done-gate.sh')} </dev/null >/dev/null 2>${err}`],
        { timeout: 30000 })
    } catch (e) { code = e.status ?? -1 }
    return { code, err: fs.existsSync(err) ? fs.readFileSync(err, 'utf8') : '', marker, root }
  }
  return run
}

check('a clean typecheck allows the stop and consumes the marker', () => {
  const fs = require$('node:fs')
  const r = gateSandbox('exit 0')()
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}`)
  assert.ok(!fs.existsSync(r.marker), 'marker was not consumed on a clean run')
  fs.rmSync(r.root, { recursive: true, force: true })
})

check('a REAL type error blocks and names the error', () => {
  const fs = require$('node:fs')
  const r = gateSandbox('echo "src/a.ts(1,14): error TS2322: nope"; exit 2')()
  assert.equal(r.code, 2, `gate did not block on a type error (exit ${r.code}) — it is not typechecking`)
  assert.match(r.err, /error TS2322/, `block message did not name the error:\n${r.err}`)
  fs.rmSync(r.root, { recursive: true, force: true })
})

check('a non-type toolchain failure blocks WITH the real output', () => {
  const fs = require$('node:fs')
  const r = gateSandbox('echo "npm ERR! broken install" >&2; exit 7')()
  assert.equal(r.code, 2, `expected a block, got ${r.code}`)
  assert.match(r.err, /toolchain failure/, 'did not explain it was a toolchain failure')
  assert.match(r.err, /broken install/, 'did not show the real output')
  fs.rmSync(r.root, { recursive: true, force: true })
})

assert.equal(failures, 0, `${failures} enforcement check(s) failed`)
console.log(`\nOK — Claude Code enforcement layer verified (${ran} checks).`)
