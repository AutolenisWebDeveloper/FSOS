// Workshop/Seminar lead-engine P0 proof. Two parts, both DB-free:
//   1. Pure decision logic (src/lib/workshops/logic.ts) — the publish hard-gate,
//      the securities auto-flag, and slug generation, compiled standalone with tsc.
//   2. Static migration guarantees (038) — RLS enabled on every new table, no anon
//      grant, the publish trigger exists, and disclosure seeds are placeholders.
// Run: node tests/workshops-gate.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-wshop-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})

let passed = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  console.log(`  ✓ ${name}`)
  passed++
}

// ── Part 1: pure logic ──
execSync(
  `npx tsc src/lib/workshops/logic.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { cwd: root, stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateWorkshopPublish, deriveIsSecurity, slugify } = require(join(out, 'logic.js'))

console.log('\nPublish hard-gate (evaluateWorkshopPublish)')
ok('non-publish transitions are always allowed', evaluateWorkshopPublish({ nextStatus: 'pending_review', hasApprovedApproval: false, hasApprovedDisclosure: false }).canPublish === true)
ok('publish BLOCKED with no approval and no disclosure', evaluateWorkshopPublish({ nextStatus: 'published', hasApprovedApproval: false, hasApprovedDisclosure: false }).canPublish === false)
ok('publish BLOCKED with approval but no approved disclosure', evaluateWorkshopPublish({ nextStatus: 'published', hasApprovedApproval: true, hasApprovedDisclosure: false }).canPublish === false)
ok('publish BLOCKED with disclosure but no approval', evaluateWorkshopPublish({ nextStatus: 'published', hasApprovedApproval: false, hasApprovedDisclosure: true }).canPublish === false)
ok('publish ALLOWED only with both prerequisites', evaluateWorkshopPublish({ nextStatus: 'published', hasApprovedApproval: true, hasApprovedDisclosure: true }).canPublish === true)
ok('blocked reasons are enumerated', evaluateWorkshopPublish({ nextStatus: 'published', hasApprovedApproval: false, hasApprovedDisclosure: false }).reasons.length === 2)

console.log('\nSecurities auto-flag (deriveIsSecurity)')
ok('third-party presenter flags securities', deriveIsSecurity([{ is_third_party: true }]) === true)
ok('fund-family presenter flags securities', deriveIsSecurity([{ fund_family: 'Some Fund' }]) === true)
ok('wholesaler presenter flags securities', deriveIsSecurity([{ presenter_type: 'wholesaler' }]) === true)
ok('internal-only presenters do NOT flag securities', deriveIsSecurity([{ is_third_party: false, presenter_type: 'internal' }]) === false)
ok('empty presenter list is not securities', deriveIsSecurity([]) === false)

console.log('\nSlug generation')
ok('slugify lowercases + hyphenates', slugify('Retirement Income 2026!') === 'retirement-income-2026')
ok('slugify trims punctuation edges', slugify('  Life & Legacy  ') === 'life-legacy')

// ── Part 2: static migration guarantees ──
console.log('\nMigration 038 static guarantees')
const mig = readFileSync(join(root, 'supabase/migrations/038_workshops_seminar_engine.sql'), 'utf8')
const NEW_TABLES = [
  'workshop_disclosure_configs',
  'presenters',
  'workshop_presenters',
  'workshop_sessions',
  'workshop_attendance',
  'workshop_consent_events',
  'workshop_materials',
  'workshop_approvals',
]
for (const t of NEW_TABLES) {
  ok(`RLS enabled on ${t}`, new RegExp(`alter table ${t}\\s+enable row level security`).test(mig))
}
ok('publish-gate trigger is defined', /create trigger trg_workshop_publish_gate/.test(mig))
ok('publish-gate function raises without approval', /no approved compliance approval/.test(mig))
ok('publish-gate function raises without disclosure', /no approved disclosure config/.test(mig))
ok('no anon RLS grant in the migration', !/grant\s+.*\bto\s+anon\b/i.test(mig))
ok('no destructive drop table in the migration', !/drop\s+table/i.test(mig))
ok('disclosure seeds are placeholders (is_assumption true)', /\[PLACEHOLDER/.test(mig))
ok('consent-evidence table stores disclosure text + version', /disclosure_text\s+text not null/.test(mig) && /disclosure_version\s+text not null/.test(mig))

console.log(`\n${passed} checks passed.\n`)
