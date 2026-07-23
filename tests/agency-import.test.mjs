// Agency Directory importer — pure-core proof (no live Supabase).
// Compiles the mapping lib + CSV parser and runs the committed directory file
// (data/agency_directory_2026.csv) through the exact map/validate/dedupe path
// the /api/agencies/import route uses, asserting:
//   • header recognition (agent code, name, address, both phones, email, flags);
//   • per-row normalization (E.164 phones, upper-cased agent code, owner-derived
//     agency name, prospecting flags);
//   • terminal validation (missing name / no identifier → rejected, not written);
//   • in-file dedupe by the natural key (agent code → email → phone).
// Run: node tests/agency-import.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.agency-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
})
execSync(
  `npx tsc src/lib/agencyDirectory.ts src/lib/csv.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  detectAgencyColumns,
  resolveAgencyColumns,
  mapAndValidateAgency,
  normalizePhone,
  normalizeAgentCode,
  parseFlag,
} = require(join(out, 'agencyDirectory.js'))
const { parseCsvRecords } = require(join(out, 'csv.js'))

const results = []
function check(name, fn, evidence) {
  try {
    fn()
    results.push({ pass: true, name, evidence: evidence ? evidence() : '' })
  } catch (e) {
    results.push({ pass: false, name, evidence: e.message })
  }
}

const HEADERS = ['Agent', 'First', 'Last', 'Address', 'City', 'State', 'Zip', 'Business Phone', 'Mobile', 'Email Address', 'Existing leads user', 'Interested']

// 1 — header recognition
check(
  'Directory headers resolve to the required fields',
  () => {
    const { hasName, hasIdentifier, map } = resolveAgencyColumns(HEADERS)
    assert.equal(hasName, true)
    assert.equal(hasIdentifier, true)
    const fields = new Set(Object.values(map))
    for (const f of ['agent_code', 'first_name', 'last_name', 'email', 'business_phone', 'mobile_phone', 'address', 'city', 'zip', 'existing_leads_user', 'interested']) {
      assert.ok(fields.has(f), `missing mapped field: ${f}`)
    }
  },
  () => 'name + identifier present; all directory columns mapped',
)

// 2 — a short/headerless file is rejected as unrecognized
check('A file without name/identifier columns is not accepted', () => {
  const { hasName, hasIdentifier } = resolveAgencyColumns(['Column 1', 'Notes'])
  assert.ok(!(hasName && hasIdentifier))
})

// 3 — normalizers
check('Phones normalize to E.164; agent codes upper-case; flags parse', () => {
  assert.equal(normalizePhone('(361) 993-8412'), '+13619938412')
  assert.equal(normalizePhone('3618553750'), '+13618553750')
  assert.equal(normalizeAgentCode('19413j'), '19413J')
  assert.equal(parseFlag('Y'), true)
  assert.equal(parseFlag('y'), true)
  assert.equal(parseFlag(''), false)
  assert.equal(parseFlag('no'), false)
})

// 4 — a full row maps cleanly; agency name derives from the owner
check(
  'A directory row maps to a valid partnership+owner payload',
  () => {
    const colMap = detectAgencyColumns(HEADERS)
    const rec = Object.fromEntries(HEADERS.map((h, i) => [h, ['19413J', 'Adriana', 'Vasquez', '2743 Airline Rd. #107', 'Corpus Christi', 'TX', '78414', '(361) 993-8412', '(361) 658-2023', 'avasquez@farmersagent.com', 'Y', ''][i]]))
    const { agency, errors } = mapAndValidateAgency(rec, colMap, { state: 'TX' })
    assert.deepEqual(errors, [])
    assert.equal(agency.agent_code, '19413J')
    assert.equal(agency.owner_name, 'Adriana Vasquez')
    assert.equal(agency.agency_name, 'Adriana Vasquez') // derived — no agency column
    assert.equal(agency.email, 'avasquez@farmersagent.com')
    assert.equal(agency.business_phone, '+13619938412')
    assert.equal(agency.mobile_phone, '+13616582023')
    assert.equal(agency.office_state, 'TX')
    assert.equal(agency.existing_leads_user, true)
    assert.equal(agency.interested, false)
    assert.equal(agency.dedupeKey, '19413J') // agent code preferred
  },
)

// 5 — terminal validation: no name, and no identifier at all
check('Rows without a name or without any identifier are rejected', () => {
  const colMap = detectAgencyColumns(HEADERS)
  const noName = mapAndValidateAgency({ 'Email Address': 'x@y.com' }, colMap)
  assert.equal(noName.agency, null)
  const noId = mapAndValidateAgency({ First: 'Jane', Last: 'Doe' }, colMap)
  assert.equal(noId.agency, null)
})

// 6 — invalid email is a terminal error (never silently written)
check('An invalid email fails the row', () => {
  const colMap = detectAgencyColumns(HEADERS)
  const { agency, errors } = mapAndValidateAgency({ First: 'Jane', Last: 'Doe', Agent: '12345', 'Email Address': 'not-an-email' }, colMap)
  assert.equal(agency, null)
  assert.ok(errors.some((e) => /email/i.test(e)))
})

// 7 — end-to-end over the committed directory: every row maps, and the one
// agent listed twice (Benjamin Burns, 19411H — two office locations) collapses
// to a single partnership via the agent-code natural key.
check(
  'The committed 2026 directory maps to 32 unique agencies (1 duplicate agent collapsed)',
  () => {
    const csv = readFileSync(join(process.cwd(), 'data/agency_directory_2026.csv'), 'utf8')
    const { headers, rows } = parseCsvRecords(csv)
    const { map, hasName, hasIdentifier } = resolveAgencyColumns(headers)
    assert.ok(hasName && hasIdentifier)
    assert.equal(rows.length, 33)
    const seen = new Set()
    let unique = 0
    let dup = 0
    for (const r of rows) {
      const { agency } = mapAndValidateAgency(r, map, { state: 'TX' })
      assert.ok(agency, `row failed to map: ${JSON.stringify(r)}`)
      if (seen.has(agency.dedupeKey)) dup++
      else {
        seen.add(agency.dedupeKey)
        unique++
      }
    }
    assert.equal(unique, 32)
    assert.equal(dup, 1)
  },
  () => '33 rows → 32 unique agencies, 1 duplicate (Benjamin Burns, 2 offices)',
)

const failed = results.filter((r) => !r.pass)
for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.evidence ? ` — ${r.evidence}` : ''}`)
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} agency-import checks passed.`)
