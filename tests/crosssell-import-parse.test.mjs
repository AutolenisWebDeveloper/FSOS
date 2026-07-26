// Cross-Sell import parser — header-detection proof (no live Supabase).
// Reproduces the real "District Cross Sell — Life" Salesforce export, which
// prefixes a banner title row and a "Households: N …" summary row ABOVE the real
// header (Account Name | Active LOB | …). Before the fix, parseCrossSellTable
// assumed the header was row 0, mapped zero columns, and skipped every row — the
// route then returned "No usable rows found in the file." This proves the parser
// now locates the real header row, normalizes the data below it, and stays
// backward-compatible with a clean header-on-row-0 file.
//
// Compiles the pure parser (crossSellList) + its dep-free helpers (normalize,
// csv) in isolation. Run: node tests/crosssell-import-parse.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.crosssell-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
})

execSync(
  `npx tsc src/lib/import/crossSellList.ts src/lib/contacts/normalize.ts src/lib/csv.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { parseCrossSellTable, summarizeCrossSell } = require(join(out, 'import/crossSellList.js'))
const { matrixToTable } = require(join(out, 'csv.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// The exact shape of the District Cross Sell — Life export: a banner title row,
// a summary line, the real header on the third row, then household rows. Both
// preamble rows populate only the first column (a merged banner), exactly like
// the file that triggered the bug report.
const HEADER = [
  'Account Name', 'Active LOB', 'Street', 'City', 'State', 'Zip',
  'Preferred Household Phone', 'Preferred Household Email', 'Agency AOR', 'Agency of Record',
]
const bannerMatrix = [
  ['District Cross Sell — Life', '', '', '', '', '', '', '', '', ''],
  ['Households: 3   |   Updated July 24, 2026', '', '', '', '', '', '', '', '', ''],
  HEADER,
  ['22173402 2 So Carrillo Household', 'Auto;Home', '5347 Flynn Pkwy', 'Corpus Christi', 'Texas', '78411-4807', '(361) 555-1234', 'carrillo@example.com', '19413P', 'Eric Cibrian Agency'],
  ["A'lana D Welch Household", 'Auto;Home;Umbrella', '388 Indian Mound Rd', 'Tarpley', 'Texas', '78883-4431', '', '', '19413K', 'Richard Peetz Agency'],
  ['A. Leslie Rozzell Household', 'Home;Flood', '1030 Bayshore Dr', 'Ingleside', 'Texas', '78362-4647', '(602) 903-8352 DNC', 'rozzell@example.com unsubscribed', '19413K', 'Frank Gonzalez Agency'],
]

console.log('Header detection through the banner preamble (the bug)')

t('finds the real header below the banner + summary rows and parses every household', () => {
  const table = matrixToTable(bannerMatrix)
  const { records, skipped } = parseCrossSellTable(table)
  assert.equal(records.length, 3, 'all three household rows should parse')
  assert.equal(skipped, 0, 'no data rows should be skipped')
  assert.deepEqual(
    records.map((r) => r.full_name),
    ['22173402 2 So Carrillo', "A'lana D Welch", 'A. Leslie Rozzell'],
    'the trailing " Household" is stripped from each name',
  )
})

t('normalizes lines of business, address, phone, email, and dedupe keys', () => {
  const { records } = parseCrossSellTable(matrixToTable(bannerMatrix))
  const carrillo = records[0]
  assert.deepEqual(carrillo.lines_of_business, ['Auto', 'Home'])
  assert.equal(carrillo.city, 'Corpus Christi')
  assert.equal(carrillo.state, 'TX')
  assert.equal(carrillo.zip, '78411-4807')
  assert.equal(carrillo.zip5, '78411')
  assert.equal(carrillo.phone, '(361) 555-1234')
  assert.equal(carrillo.phone_digits, '3615551234')
  assert.equal(carrillo.email, 'carrillo@example.com')
  assert.equal(carrillo.crosssell_key, `${carrillo.name_key}|78411`)
})

t('captures Umbrella and Flood lines and derives compliance flags from inline markers', () => {
  const { records } = parseCrossSellTable(matrixToTable(bannerMatrix))
  const welch = records[1]
  assert.deepEqual(welch.lines_of_business, ['Umbrella', 'Auto', 'Home'])
  const rozzell = records[2]
  assert.deepEqual(rozzell.lines_of_business, ['Flood', 'Home'])
  assert.equal(rozzell.phone_dnc, true, 'a "DNC" marker in the phone cell flags do-not-call')
  assert.equal(rozzell.email_unsub, true, 'an "unsubscribed" marker in the email cell flags opt-out')
})

t('summary reflects the parsed records', () => {
  const { records } = parseCrossSellTable(matrixToTable(bannerMatrix))
  const s = summarizeCrossSell(records)
  assert.equal(s.total, 3)
  assert.equal(s.with_phone, 2)
  assert.equal(s.with_email, 2)
  assert.equal(s.dnc, 1)
  assert.equal(s.email_unsub, 1)
  assert.equal(s.by_state.TX, 3)
})

console.log('Backward compatibility + edge cases')

t('a clean file with the header already on row 0 still parses', () => {
  const clean = [
    HEADER,
    ['Jane Doe Household', 'Auto', '1 Main St', 'Dallas', 'TX', '75001', '214-555-0000', 'jane@example.com', '111', 'Some Agency'],
  ]
  const { records, skipped } = parseCrossSellTable(matrixToTable(clean))
  assert.equal(records.length, 1)
  assert.equal(skipped, 0)
  assert.equal(records[0].full_name, 'Jane Doe')
})

t('footer / total rows in the data region are skipped, not parsed as people', () => {
  const withFooter = [
    ...bannerMatrix,
    ['Total', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
  ]
  const { records, skipped } = parseCrossSellTable(matrixToTable(withFooter))
  assert.equal(records.length, 3, 'the three real households, and only those')
  assert.equal(skipped, 1, 'the "Total" footer row is skipped (the blank row is ignored, not counted)')
})

t('a table with no recognizable header yields zero records (route reports "no usable rows")', () => {
  const junk = [
    ['some banner', '', ''],
    ['note: nothing useful here', '', ''],
    ['x', 'y', 'z'],
  ]
  const { records } = parseCrossSellTable(matrixToTable(junk))
  assert.equal(records.length, 0)
})

console.log(`\n${passed} assertions passed.`)
