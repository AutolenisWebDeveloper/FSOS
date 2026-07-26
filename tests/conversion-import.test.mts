// Life Conversion importer — parser proof for the raw "District Life Conversion"
// export (the format that previously failed with "Could not find the conversion
// header row"). Covers three regressions:
//   1. Header aliases — "Conversion Expiring Date" / "Policy Holder Name" /
//      "Coverage Amount" / "Primary Insured Name" now resolve, so the header row
//      is found instead of throwing.
//   2. Hyperlink cells — the Policy Number column is a hyperlink whose DISPLAY
//      text is the numeric policy number and whose href is an Okta URL. The
//      parser must return the policy number, not the URL (else the match key
//      breaks for the whole import).
//   3. New contact columns — Preferred Email / Preferred Phone / Agent of Record
//      are captured onto each record.
// Uses a synthetic in-memory workbook (no client PII committed to the repo).
// Run: npx tsx tests/conversion-import.test.mts
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { parseConversionFile, planConversionCreates, conversionOwnerKey, type ConversionRecord } from '@/lib/import/conversionList'

let passed = 0
const t = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  passed++
  console.log('  ✓', name)
}

const HEADERS = [
  'Conversion Expiring Date', 'Policy Number', 'Policy Holder Name', 'Primary Insured Name',
  'Inception Date', 'Product Type', 'Coverage Amount', 'Expiration Date',
  'AOR Code', 'Preferred Email', 'Preferred Phone Number', 'Agent of Record',
]

// Build a workbook mirroring the real export: two preamble title rows, a blank
// row, the header row, then data. Policy Number + Primary Insured + Email are
// hyperlink cells; the policy hyperlink's text is a NUMBER, href is an Okta URL.
async function buildXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Conversions')
  ws.addRow(['District Life Conversion'])
  ws.addRow(['Term Conversion Opportunity Report'])
  ws.addRow([])
  ws.addRow(HEADERS)
  // Row with full contact info; policy number is a numeric-text hyperlink.
  const r5 = ws.addRow([
    new Date(Date.UTC(2026, 6, 28)), null, 'ORNELAS, DELFINO', 'ORNELAS, DELFINO',
    new Date(Date.UTC(2006, 6, 28)), '10 Yr Term', 150000, new Date(Date.UTC(2070, 6, 28)),
    '19-41-319', null, '(210) 710-9625', 'Stephanie Waterman Agency',
  ])
  r5.getCell(2).value = { text: 7814352, hyperlink: 'https://farmersinsurance.okta.com/home/okta_org2org/x/51975' }
  r5.getCell(10).value = { text: 'dornelas3@yahoo.com', hyperlink: 'mailto:dornelas3@yahoo.com' }
  // Row without email/phone (sparse contact info is common in the real file).
  const r6 = ws.addRow([
    new Date(Date.UTC(2026, 6, 28)), null, 'SALAZAR, MARTA L', 'SALAZAR, MARTA L',
    new Date(Date.UTC(2006, 6, 28)), '20 Yr Term', 250000, new Date(Date.UTC(2062, 6, 28)),
    '19-41-594', null, null, 'Horacio Villarreal Agency',
  ])
  r6.getCell(2).value = { text: 7764583, hyperlink: 'https://farmersinsurance.okta.com/home/okta_org2org/x/51976' }
  // Footer row (no policy number) — must be skipped, not parsed as a record.
  ws.addRow(['', '', 'Total Convertible Amount', '', '', '', 400000])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// 1 — the export that used to throw now parses.
await t('District export header row is recognized (no throw)', async () => {
  const buf = await buildXlsx()
  const res = await parseConversionFile(buf, 'District_Life_conversion.xlsx')
  assert.equal(res.records.length, 2, `expected 2 records, got ${res.records.length}`)
  assert.equal(res.skipped, 1, 'the Total footer row must be skipped')
})

// 2 — hyperlink Policy Number resolves to the number, not the Okta URL.
await t('hyperlink policy number returns the display number, not the href', async () => {
  const res = await parseConversionFile(await buildXlsx(), 'x.xlsx')
  const nums = res.records.map((r) => r.policy_number).sort()
  assert.deepEqual(nums, ['7764583', '7814352'])
  for (const r of res.records) assert.ok(!/https?:|okta/.test(r.policy_number), `policy leaked href: ${r.policy_number}`)
  // conversion_key mirrors the policy number (idempotent provenance).
  assert.equal(res.records[0].conversion_key, res.records[0].policy_number)
})

// 3 — dates, amount, names, and the new contact columns are captured.
await t('dates, coverage amount, names and contact columns parse', async () => {
  const res = await parseConversionFile(await buildXlsx(), 'x.xlsx')
  const del = res.records.find((r) => r.policy_number === '7814352')!
  assert.equal(del.owner_name, 'Delfino Ornelas', 'LAST, FIRST → First Last')
  assert.equal(del.insured_name, 'Delfino Ornelas')
  assert.equal(del.product_type, '10 Yr Term')
  assert.equal(del.convertible_amount, 150000)
  assert.equal(del.conversion_deadline, '2026-07-28')
  assert.equal(del.inception_date, '2006-07-28')
  assert.equal(del.expiration_date, '2070-07-28')
  assert.equal(del.preferred_email, 'dornelas3@yahoo.com')
  assert.equal(del.preferred_phone, '(210) 710-9625')
  assert.equal(del.agent_of_record, 'Stephanie Waterman Agency')
  assert.equal(del.aor_code, '19-41-319')
  assert.equal(res.total_convertible, 400000, 'sum of the two convertible amounts')
  // Sparse row: no email/phone, but still a valid record.
  const mar = res.records.find((r) => r.policy_number === '7764583')!
  assert.equal(mar.preferred_email, null)
  assert.equal(mar.preferred_phone, null)
})

// 4 — CSV variant of the raw headers resolves too (format-agnostic detection).
await t('raw District headers resolve from CSV as well', async () => {
  const csv = [
    'District Life Conversion',
    HEADERS.join(','),
    '07/28/2026,7814352,"ORNELAS, DELFINO","ORNELAS, DELFINO",07/28/2006,10 Yr Term,150000,07/28/2070,19-41-319,dornelas3@yahoo.com,(210) 710-9625,Stephanie Waterman Agency',
  ].join('\n')
  const res = await parseConversionFile(Buffer.from(csv, 'utf8'), 'district.csv')
  assert.equal(res.records.length, 1)
  assert.equal(res.records[0].policy_number, '7814352')
  assert.equal(res.records[0].conversion_deadline, '2026-07-28')
})

// 5 — a file with no policy column still fails clearly (guardrail preserved).
await t('a file without a Policy Number column still throws a clear error', async () => {
  const csv = 'Name,Amount\nJane Doe,100\n'
  await assert.rejects(
    () => parseConversionFile(Buffer.from(csv, 'utf8'), 'bad.csv'),
    /Could not find the conversion header row/,
  )
})

// ── Create plan (unmatched rows → new book records) ──────────────────────────
const rec = (over: Partial<ConversionRecord>): ConversionRecord => ({
  policy_number: '1000', owner_name: 'Delfino Ornelas', insured_name: 'Delfino Ornelas', insured_dob: null,
  product_type: '10 Yr Term', convertible_amount: 150000, conversion_deadline: '2026-07-28',
  inception_date: '2006-07-28', expiration_date: '2070-07-28', preferred_email: null, preferred_phone: null,
  agent_of_record: null, aor_code: null, name_key: 'delfinoornelas', conversion_key: '1000', ...over,
})

// 6 — each unmatched row is originated: one household per owner, one policy per row.
await t('unmatched rows produce a create plan (household + policy per row)', () => {
  const plan = planConversionCreates([
    rec({ policy_number: '1000', owner_name: 'Delfino Ornelas' }),
    rec({ policy_number: '1001', owner_name: 'Marta L Salazar', insured_name: 'Marta L Salazar' }),
  ], new Set())
  assert.equal(plan.households.length, 2, 'two distinct owners → two households')
  assert.equal(plan.policies.length, 2, 'two rows → two policies')
  const p = plan.policies.find((x) => x.policy_number === '1000')!
  assert.equal(p.book_owner_key, conversionOwnerKey('Delfino Ornelas'))
  assert.equal(p.face_amount, 150000)
  assert.equal(p.conversion_deadline, '2026-07-28')
  assert.equal(p.is_security, false, 'term product is NOT a security (firewall)')
})

// 7 — two policies for the same owner collapse into ONE household.
await t('same owner, two policies → one household, two policies', () => {
  const plan = planConversionCreates([
    rec({ policy_number: '2000', owner_name: 'Jane Doe', insured_name: 'Jane Doe' }),
    rec({ policy_number: '2001', owner_name: 'Jane Doe', insured_name: 'John Doe' }),
  ], new Set())
  assert.equal(plan.households.length, 1, 'one owner → one household')
  assert.equal(plan.policies.length, 2, 'two policies under that household')
  assert.deepEqual(plan.households[0].insured_names, ['John Doe'], 'insured differing from owner recorded as member; owner-as-insured excluded')
})

// 8 — an existing household is never re-created, but its new policy is still planned.
await t('existing household key → no re-create, policy still linked', () => {
  const key = conversionOwnerKey('Jane Doe')
  const plan = planConversionCreates([rec({ policy_number: '3000', owner_name: 'Jane Doe' })], new Set([key]))
  assert.equal(plan.households.length, 0, 'household already exists → not re-created')
  assert.equal(plan.policies.length, 1, 'policy still originated against the existing household')
  assert.equal(plan.policies[0].book_owner_key, key)
})

// 9 — a row with no owner name has no home on the spine → skipped.
await t('row without an owner name is skipped (no household to attach)', () => {
  const plan = planConversionCreates([rec({ policy_number: '4000', owner_name: '' })], new Set())
  assert.equal(plan.households.length, 0)
  assert.equal(plan.policies.length, 0)
})

// 10 — variable product is firewalled even if it slips into a conversion list.
await t('variable product is flagged is_security (firewall holds)', () => {
  const plan = planConversionCreates([rec({ policy_number: '5000', product_type: 'Variable Universal Life' })], new Set())
  assert.equal(plan.policies[0].is_security, true, 'variable → is_security true')
})

// 11 — the owner key matches the In-Force Book derivation with an empty ZIP.
await t('conversionOwnerKey matches the shared book_owner_key form (name|)', () => {
  assert.equal(conversionOwnerKey('  Delfino   Ornelas '), 'delfino ornelas|')
})

// 12 — duplicate policy numbers across rows are de-duplicated in the plan.
await t('duplicate policy numbers are collapsed to one policy', () => {
  const plan = planConversionCreates([
    rec({ policy_number: '6000', owner_name: 'Sam Roe' }),
    rec({ policy_number: '6000', owner_name: 'Sam Roe' }),
  ], new Set())
  assert.equal(plan.policies.length, 1, 'same policy number appears once')
})

console.log(`\nconversion-import: ${passed} checks passed`)
