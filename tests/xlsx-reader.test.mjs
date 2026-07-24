// xlsxRaw reader — parity proof for the exceljs removal.
// The contact/book import pipeline used to read .xlsx via exceljs (whose
// transitive deps — glob@7, inflight, rimraf@2, fstream, uuid@8, lodash.isequal
// — were all deprecated). exceljs was removed and src/lib/import/xlsxRaw.ts is
// now the single .xlsx reader. This test compiles that reader, builds minimal
// workbooks in-memory with JSZip (already a shipped dependency), and asserts the
// reader still handles every cell shape the importers depend on:
//   • shared strings, inline strings, and t="str" cells;
//   • plain numbers and date-styled serials → ISO dates;
//   • booleans;
//   • namespace-prefixed SpreadsheetML (<x:row>/<x:c>) — the Salesforce-export
//     case that was the original reason this reader exists;
//   • first-NON-EMPTY worksheet selection (parity with the old
//     `worksheets.find(w => w.rowCount > 0) || worksheets[0]`).
// Run: node tests/xlsx-reader.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.xlsx-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
})
execSync(
  `npx tsc src/lib/import/xlsxRaw.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { xlsxToMatrix } = require(join(out, 'xlsxRaw.js'))
const JSZip = require('jszip')

// ── minimal-workbook builder ────────────────────────────────────────────────
const CT = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`
const sharedStrings = (arr) =>
  `<?xml version="1.0"?><sst count="${arr.length}" uniqueCount="${arr.length}">` +
  arr.map((s) => `<si><t>${s}</t></si>`).join('') +
  `</sst>`
// cellXfs[0] = general, cellXfs[1] = builtin date (numFmtId 14).
const styles = `<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`

async function build(sheets, opts = {}) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CT)
  if (opts.shared) zip.file('xl/sharedStrings.xml', sharedStrings(opts.shared))
  zip.file('xl/styles.xml', styles)
  sheets.forEach((xml, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, xml))
  return zip.generateAsync({ type: 'nodebuffer' })
}

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push({ pass: true, name })
  } catch (e) {
    results.push({ pass: false, name, err: e.message })
  }
}

// ── 1. every cell type the importers rely on ────────────────────────────────
await check('reads shared/inline/str strings, numbers, dates, booleans', async () => {
  const sheet =
    `<worksheet><sheetData>` +
    // header row: three shared strings
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>` +
    // data: inline string, number, date-styled serial (44927 = 2023-01-01)
    `<row r="2"><c r="A2" t="inlineStr"><is><t>Alice</t></is></c><c r="B2"><v>1234.5</v></c><c r="C2" s="1"><v>44927</v></c></row>` +
    // data: shared string, zero, explicit string, boolean true
    `<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>0</v></c><c r="C3" t="str"><v>n/a</v></c><c r="D3" t="b"><v>1</v></c></row>` +
    `</sheetData></worksheet>`
  const buf = await build([sheet], { shared: ['Name', 'Amount', 'Issued', 'Bob'] })
  const m = await xlsxToMatrix(buf)
  assert.deepEqual(m[0], ['Name', 'Amount', 'Issued'])
  assert.deepEqual(m[1], ['Alice', '1234.5', '2023-01-01'])
  assert.deepEqual(m[2], ['Bob', '0', 'n/a', 'true'])
})

// ── 2. column alignment preserved across gaps (A, then C — B is empty) ───────
await check('preserves column position when a cell is absent', async () => {
  const sheet =
    `<worksheet><sheetData>` +
    `<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="C1" t="inlineStr"><is><t>z</t></is></c></row>` +
    `</sheetData></worksheet>`
  const buf = await build([sheet])
  const m = await xlsxToMatrix(buf)
  assert.deepEqual(m[0], ['x', '', 'z'])
})

// ── 3. namespace-prefixed SpreadsheetML (the Salesforce-export case) ─────────
await check('tolerates <x:…> namespace-prefixed tags', async () => {
  const sheet =
    `<x:worksheet><x:sheetData>` +
    `<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Policy</x:t></x:is></x:c></x:row>` +
    `<x:row r="2"><x:c r="A2"><x:v>42</x:v></x:c></x:row>` +
    `</x:sheetData></x:worksheet>`
  const buf = await build([sheet])
  const m = await xlsxToMatrix(buf)
  assert.deepEqual(m[0], ['Policy'])
  assert.deepEqual(m[1], ['42'])
})

// ── 4. first NON-EMPTY worksheet wins (blank lead tab is skipped) ────────────
await check('selects the first non-empty worksheet', async () => {
  const empty = `<worksheet><sheetData></sheetData></worksheet>`
  const data =
    `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>real</t></is></c></row></sheetData></worksheet>`
  const buf = await build([empty, data])
  const m = await xlsxToMatrix(buf)
  assert.deepEqual(m[0], ['real'])
})

// ── 5. XML entities are unescaped ────────────────────────────────────────────
await check('unescapes XML entities in strings', async () => {
  const sheet =
    `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`
  const buf = await build([sheet], { shared: ['Smith &amp; Jones &lt;LLC&gt;'] })
  const m = await xlsxToMatrix(buf)
  assert.deepEqual(m[0], ['Smith & Jones <LLC>'])
})

// ── report ──────────────────────────────────────────────────────────────────
let failed = 0
for (const r of results) {
  if (r.pass) console.log(`  ✓ ${r.name}`)
  else {
    failed++
    console.error(`  ✗ ${r.name}\n      ${r.err}`)
  }
}
console.log(`\nxlsx-reader: ${results.length - failed}/${results.length} passed`)
if (failed) process.exit(1)
