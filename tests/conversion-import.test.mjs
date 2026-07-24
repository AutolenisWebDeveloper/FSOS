// tests/conversion-import.test.mjs
// Proves the Life Conversion importer's parse/AOR/consent behavior:
//   • a HYPERLINKED policy-number cell (District/Okta export) resolves to its
//     display number, NOT the identical Okta launch URL — the bug that made every
//     row collapse to one key and broke the upload;
//   • the Agent-of-Record series code + agency name are captured and turned into the
//     source_data hint keys the household_policies AOR resolver reads;
//   • the channel indicators (DNC / PWC Revoked / DNC Litigator / Unsubscribed /
//     Held) become the correct do-not-contact ledger entries and litigator flag;
//   • two worksheets (series codes on one, agency names on the other) merge by
//     policy number into one record.
// Compiles conversionList.ts (ExcelJS + jszip external) and drives it with a
// workbook synthesized by ExcelJS. Run: node tests/conversion-import.test.mjs

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let mod, ExcelJS
// The bundle keeps exceljs/jszip external, so it must sit inside the repo to
// resolve them from node_modules; write it to a hidden temp file in cwd.
const out = join(process.cwd(), `.conv-import-test.${process.pid}.cjs`)
try {
  execSync(
    `npx --yes esbuild@0.21.5 src/lib/import/conversionList.ts --bundle --platform=node --format=cjs --tsconfig=tsconfig.json --external:exceljs --external:jszip --outfile=${out}`,
    { stdio: 'ignore' },
  )
  mod = require(out)
  ExcelJS = require('exceljs')
  rmSync(out, { force: true })
} catch (e) {
  rmSync(out, { force: true })
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild/exceljs unavailable:', e.message)
    process.exit(1)
  }
  console.log('SKIP conversion-import.test.mjs (esbuild/exceljs unavailable):', e.message)
  process.exit(0)
}

let passed = 0
function t(name, fn) {
  try { fn(); passed++; console.log('  ok -', name) }
  catch (e) { console.error('  FAIL -', name, '\n', e.stack || e.message); process.exitCode = 1 }
}

// Build a two-sheet workbook mirroring the District export: Sheet1 carries the
// series code + consent indicators with a HYPERLINKED numeric policy number and a
// preamble; Sheet2 carries the agency name. Returns an .xlsx Buffer.
async function synthWorkbook() {
  const wb = new ExcelJS.Workbook()
  const s1 = wb.addWorksheet('Sheet1')
  s1.addRow([]) // preamble/title block the parser must skip
  s1.addRow(['District Life Conversion — Q3'])
  s1.addRow(['Conversion Expiry Date', 'Policy Number', 'Policy Owner', 'Primary Named Insured', 'Insured Birthday', 'Inception Date', 'Product Type', 'Convertible Amount', 'Expiration Date', 'AOR with Series Code', 'PNI Preferred Email', 'PNI Preferred Phone', 'PNI Email Indicator', 'PNI Phone Indicator'])
  const r1 = s1.addRow([new Date(Date.UTC(2026, 6, 28)), null, 'SALAZAR, MARTA L', 'SALAZAR, MARTA L', new Date(Date.UTC(2026, 4, 12)), new Date(Date.UTC(2006, 6, 28)), '10 Yr Term', 150000, new Date(Date.UTC(2062, 6, 28)), '19-41-594', 'MARTA@example.com', '(210) 555-1000', '✅', 'CELL, DNC'])
  // Policy number is a hyperlink whose display text is the NUMBER (the bug trigger).
  r1.getCell(2).value = { text: 7764583, hyperlink: 'https://farmersinsurance.okta.com/home/okta_org2org/0oa10rs1k5hfncK9m1t8/51975' }
  const r2 = s1.addRow([new Date(Date.UTC(2026, 6, 28)), null, 'ORNELAS, DELFINO', 'ORNELAS, DELFINO', new Date(Date.UTC(2026, 5, 25)), new Date(Date.UTC(2006, 6, 28)), '10 Yr Term', 250000, new Date(Date.UTC(2070, 6, 28)), '19-41-319', 'dornelas3@yahoo.com', '(210) 710-9625', '✅Unsubscribed', 'CELL, DNC, PWC Revoked'])
  r2.getCell(2).value = { text: 7814352, hyperlink: 'https://farmersinsurance.okta.com/home/okta_org2org/0oa10rs1k5hfncK9m1t8/51975' }
  const r3 = s1.addRow([new Date(Date.UTC(2026, 7, 3)), null, 'RODRIGUEZ, JAMES L', 'RODRIGUEZ, JAMES L', new Date(Date.UTC(2026, 8, 9)), new Date(Date.UTC(2006, 7, 3)), '30 Yr Term', 150000, new Date(Date.UTC(2068, 7, 3)), '19-41-340', 'lrod@yahoo.com', '(361) 816-8775', 'Not Verified', 'DNC Litigator'])
  r3.getCell(2).value = { text: 7783177, hyperlink: 'https://farmersinsurance.okta.com/x' }
  s1.addRow(['Total Convertible Amount', null, null, null, null, null, null, 550000]) // footer to skip

  const s2 = wb.addWorksheet('Sheet2')
  s2.addRow(['Conversion Expiry Date', 'Policy Number', 'Policy Owner', 'Primary Named Insured', 'Insured Birthday', 'Inception Date', 'Product Type', 'Convertible Amount', 'Expiration Date', 'PNI Preferred Email', 'PNI Preferred Phone', 'Agent of Record'])
  s2.addRow([new Date(Date.UTC(2026, 6, 28)), 7764583, 'MARTA L SALAZAR', 'SALAZAR, MARTA L', new Date(Date.UTC(2026, 4, 12)), new Date(Date.UTC(2006, 6, 28)), '10 Yr Term', 150000, '#Error!', null, null, 'Horacio Villarreal Agency'])
  s2.addRow([new Date(Date.UTC(2026, 6, 28)), 7814352, 'DELFINO ORNELAS', 'ORNELAS, DELFINO', new Date(Date.UTC(2026, 5, 25)), new Date(Date.UTC(2006, 6, 28)), '10 Yr Term', 250000, '#Error!', null, null, 'Stephanie Waterman Agency'])
  s2.addRow([new Date(Date.UTC(2026, 7, 3)), 7783177, 'JAMES L RODRIGUEZ', 'RODRIGUEZ, JAMES L', new Date(Date.UTC(2026, 8, 9)), new Date(Date.UTC(2006, 7, 3)), '30 Yr Term', 150000, '#Error!', null, null, 'Victor Gonzalez Ins Agency Inc'])

  return Buffer.from(await wb.xlsx.writeBuffer())
}

const buf = await synthWorkbook()
const parsed = await mod.parseConversionFile(buf, 'District_life_conversion.xlsx')
const byPolicy = Object.fromEntries(parsed.records.map((r) => [r.policy_number, r]))

t('hyperlinked policy number resolves to the display number, not the Okta URL', () => {
  assert.equal(parsed.records.length, 3, 'three unique policies')
  assert.ok(byPolicy['7764583'], 'policy 7764583 present by its number')
  for (const r of parsed.records) assert.ok(!/okta|https?:/i.test(r.policy_number), `policy_number must not be a URL: ${r.policy_number}`)
})

t('preamble + total footer rows are skipped', () => {
  assert.ok(parsed.skipped >= 1, 'the Total footer row is skipped')
})

t('AOR series code (Sheet1) + agency name (Sheet2) merge onto one record', () => {
  const r = byPolicy['7764583']
  assert.equal(r.series_code, '19-41-594')
  assert.equal(r.agency_name, 'Horacio Villarreal Agency')
})

t('conversionAorHints builds the resolver source_data keys', () => {
  const hints = mod.conversionAorHints(byPolicy['7764583'])
  assert.equal(hints['Serving Agent Number'], '19-41-594')
  assert.equal(hints['Agency Name'], 'Horacio Villarreal Agency')
  assert.deepEqual(mod.conversionAorHints({ series_code: null, agency_name: null }), {})
})

t('DNC (call) is derived; ✅ e-mail is not suppressed', () => {
  const s = mod.conversionSuppressions(byPolicy['7764583'])
  assert.deepEqual(s.map((x) => x.channel).sort(), ['call'])
  assert.equal(s[0].contact, '(210) 555-1000')
  assert.equal(s[0].litigator, false)
})

t('DNC + PWC Revoked + Unsubscribed → call, sms, email suppressions', () => {
  const s = mod.conversionSuppressions(byPolicy['7814352'])
  assert.deepEqual(s.map((x) => x.channel).sort(), ['call', 'email', 'sms'])
  assert.ok(s.every((x) => !x.litigator))
})

t('DNC Litigator → all-channel suppression + litigator flag', () => {
  const s = mod.conversionSuppressions(byPolicy['7783177'])
  const all = s.find((x) => x.channel === 'all')
  assert.ok(all, 'an all-channel entry exists')
  assert.equal(all.litigator, true)
  // A litigator supersedes the plain DNC → no separate call entry.
  assert.ok(!s.some((x) => x.channel === 'call'))
})

t('insured birthday is reduced to MM/DD (no fabricated year)', () => {
  assert.equal(byPolicy['7764583'].insured_dob, '5/12')
})

t('#Error! expiration cells parse to null, not a bad date', () => {
  for (const r of parsed.records) assert.ok(r.expiration_date === null || /^\d{4}-\d{2}-\d{2}$/.test(r.expiration_date))
})

t('summary counts AOR coverage', () => {
  const sum = mod.summarizeConversions(parsed.records, '2026-07-24')
  assert.equal(sum.with_aor, 3)
  assert.equal(sum.total, 3)
})

// A later export renamed/typo'd headers, dropped the consent columns, put the AOR
// code + agency name on one sheet, and mislabeled the Policy Owner column as a
// second "Policy Number". The parser must still map every essential field.
async function synthVariantWorkbook() {
  const wb = new ExcelJS.Workbook()
  const s = wb.addWorksheet('Sheet1')
  s.addRow([]); s.addRow([]); s.addRow([]) // 3-row preamble
  s.addRow(['Conversion Expiring Date', 'Policy Number', 'Policy Number', 'Primary Name Insurance', 'Inception Date', 'Product Type', 'Coverage Amount', 'Expiration Date', 'AOR code', 'Preffered email', 'Preffered Phone Number', 'Agent of Record'])
  const r1 = s.addRow([new Date(Date.UTC(2026, 6, 28)), null, 'MARTA L SALAZAR', 'MARTA L SALAZAR', new Date(Date.UTC(2006, 6, 28)), '10 Yr Term', 150000, new Date(Date.UTC(2062, 6, 28)), '19-41-594', null, null, 'Horacio Villarreal Agency'])
  r1.getCell(2).value = { text: 7764583, hyperlink: 'https://farmersinsurance.okta.com/home/okta_org2org/x/51975' }
  const r2 = s.addRow([new Date(Date.UTC(2026, 6, 28)), null, 'DELFINO ORNELAS', 'DELFINO ORNELAS', new Date(Date.UTC(2006, 6, 28)), '10 Yr Term', 250000, new Date(Date.UTC(2070, 6, 28)), '19-41-319', 'dornelas3@yahoo.com', '(210) 710-9625', 'Stephanie Waterman Agency'])
  r2.getCell(2).value = { text: 7814352, hyperlink: 'https://farmersinsurance.okta.com/home/okta_org2org/x/51975' }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const vparsed = await mod.parseConversionFile(await synthVariantWorkbook(), 'Disctrict_life_conversion_01.xlsx')
const vByPolicy = Object.fromEntries(vparsed.records.map((r) => [r.policy_number, r]))

t('renamed/typo headers still map every essential field', () => {
  assert.equal(vparsed.records.length, 2)
  const r = vByPolicy['7814352']
  assert.equal(r.conversion_deadline, '2026-07-28', 'Conversion Expiring Date → deadline')
  assert.equal(r.convertible_amount, 250000, 'Coverage Amount → amount')
  assert.equal(r.series_code, '19-41-319', 'AOR code → series')
  assert.equal(r.agency_name, 'Stephanie Waterman Agency', 'Agent of Record → agency')
  assert.equal(r.pni_email, 'dornelas3@yahoo.com', 'Preffered email → email')
  assert.equal(r.pni_phone, '(210) 710-9625', 'Preffered Phone Number → phone')
})

t('the duplicate "Policy Number" column is recovered as the owner', () => {
  assert.equal(vByPolicy['7764583'].owner_name, 'Marta L Salazar')
  assert.equal(vByPolicy['7764583'].insured_name, 'Marta L Salazar')
})

t('hyperlinked policy numbers stay correct in the variant layout', () => {
  for (const r of vparsed.records) assert.ok(!/okta|https?:/i.test(r.policy_number))
})

if (process.exitCode) { console.error('\nconversion-import.test.mjs FAILED'); process.exit(1) }
console.log(`\nconversion-import.test.mjs: ${passed} passed`)
