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

assert.equal(failures, 0, `${failures} enforcement check(s) failed`)
console.log(`\nOK — Claude Code enforcement layer verified (${ran} checks).`)
