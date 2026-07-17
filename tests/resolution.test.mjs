// tests/resolution.test.mjs — the shared entity-resolution engine.
// Run with: node tests/resolution.test.mjs
// The engine is TS; we bundle it to JS on the fly via esbuild if available,
// otherwise we skip with a clear notice (build/CI compiles it anyway).

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let mod
try {
  const dir = mkdtempSync(join(tmpdir(), 'reso-'))
  const out = join(dir, 'resolution.mjs')
  execSync(
    `npx --yes esbuild@0.21.5 src/lib/import/resolution.ts --bundle --platform=node --format=esm --outfile=${out}`,
    { stdio: 'ignore' },
  )
  mod = await import(out)
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  console.log('resolution.test.mjs — SKIPPED (esbuild unavailable):', e.message)
  process.exit(0)
}

const { buildContactIndex, resolveContact, mergeFields } = mod

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗', msg) }
}

const contacts = [
  { id: 'c1', full_name: 'Aaron Gonzalez', email_lc: 'aaron@example.com', phone_digits: '8304309800', zip: '78026', street: '1106 Fig St', provenanceKeys: ['owner:aarongonzalez|78026'] },
  { id: 'c2', full_name: 'Maria Lopez', zip: '78401', dob: '4/12' },
  { id: 'c3', full_name: 'Maria Lopez', zip: '78415' }, // same name, different zip
  { id: 'c4', full_name: 'John Smith', email_lc: 'john@work.com', phone_digits: '2105551212' },
]
const idx = buildContactIndex(contacts, new Map([['POL123', 'c4']]))

console.log('resolution — matching confidence')
ok(resolveContact(idx, { email: 'AARON@example.com' }).targetId === 'c1', 'email matches (case-insensitive) → c1')
ok(resolveContact(idx, { email: 'aaron@example.com' }).confidence === 'exact', 'email match is exact confidence')
ok(resolveContact(idx, { phone: '(830) 430-9800' }).targetId === 'c1', 'phone matches normalized → c1')
ok(resolveContact(idx, { provenanceKeys: ['owner:aarongonzalez|78026'] }).confidence === 'exact', 'provenance key is exact')
ok(resolveContact(idx, { policyNumbers: ['POL123'] }).targetId === 'c4', 'policy number resolves via book → c4')
ok(resolveContact(idx, { policyNumbers: ['POL123'] }).action === 'merge', 'policy match auto-merges')

console.log('resolution — false-match prevention')
const nameOnly = resolveContact(idx, { fullName: 'Aaron Gonzalez' })
ok(nameOnly.action === 'review', 'name-only → manual review (never auto-merge)')
ok(nameOnly.confidence === 'low', 'name-only is low confidence')
const ambiguous = resolveContact(idx, { fullName: 'Maria Lopez' })
ok(ambiguous.action === 'review' && ambiguous.conflict, 'ambiguous common name (two contacts) → review + conflict')
ok(ambiguous.targetId === null, 'ambiguous match does not pick a target')

console.log('resolution — name + qualifier')
ok(resolveContact(idx, { fullName: 'Maria Lopez', zip: '78401' }).targetId === 'c2', 'name+zip disambiguates → c2')
ok(resolveContact(idx, { fullName: 'Maria Lopez', zip: '78401' }).confidence === 'medium', 'name+zip is medium confidence')
ok(resolveContact(idx, { fullName: 'Maria Lopez', dob: '2000-04-12' }).targetId === 'c2', 'name+dob (full vs month/day) → c2')
ok(resolveContact(idx, { fullName: 'Aaron Gonzalez', street: '1106 Fig St', zip: '78026' }).confidence === 'high', 'name+address is high confidence')

console.log('resolution — conflict across strong identifiers')
const conflict = resolveContact(idx, { email: 'aaron@example.com', phone: '2105551212' })
ok(conflict.action === 'review' && conflict.conflict, 'email→c1 but phone→c4 → conflict → review')

console.log('resolution — no match')
ok(resolveContact(idx, { fullName: 'Nobody New', email: 'new@x.com' }).action === 'create', 'unknown row → create')

console.log('merge — no overwrite, union, rejected values')
const m = mergeFields(
  { email: 'old@x.com', phone: null, tags: ['a'], city: 'Austin' },
  { email: 'new@x.com', phone: '5125550000', tags: ['a', 'b'], city: 'Dallas' },
  [{ field: 'email' }, { field: 'phone' }, { field: 'tags', kind: 'set' }, { field: 'city' }],
)
ok(m.patch.phone === '5125550000', 'blank field filled from incoming')
ok(Array.isArray(m.patch.tags) && m.patch.tags.length === 2, 'set field unions')
ok(m.patch.email === undefined, 'non-blank differing field NOT overwritten')
ok(m.rejected.some((r) => r.field === 'email' && r.incoming === 'new@x.com'), 'overwrite attempt recorded as rejected')
ok(m.rejected.some((r) => r.field === 'city'), 'differing city rejected, not written')
ok(m.merged.includes('phone') && m.merged.includes('tags'), 'merged fields listed')

console.log(`\n${pass} passed, ${fail} failed.`)
if (fail > 0) process.exit(1)
