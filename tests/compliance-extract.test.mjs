// tests/compliance-extract.test.mjs — pure logic of the shared document-extraction
// module (src/lib/compliance/extract.ts), which backs the AI Knowledge Library upload
// path. The RightBridge structured-report assertions were removed with the Compliance
// Intelligence excision; every symbol covered here still has a live consumer.
// Bundled to JS on the fly via
// esbuild (tsconfig paths for the @/ alias; pdf2json kept external since these tests
// never invoke the PDF parser). Skips cleanly when esbuild is unavailable, like
// resolution.test.mjs — but MUST run under CI_REQUIRE_INFRA=1.

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let mod
try {
  const dir = mkdtempSync(join(tmpdir(), 'cxe-'))
  const out = join(dir, 'extract.mjs')
  execSync(
    `npx --yes esbuild@0.21.5 src/lib/compliance/extract.ts --bundle --platform=node ` +
      `--format=esm --outfile=${out} --tsconfig=tsconfig.json --external:pdf2json`,
    { stdio: 'ignore' },
  )
  mod = await import(out)
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild is unavailable:', e.message)
    process.exit(1)
  }
  console.log('compliance-extract.test.mjs — SKIPPED (esbuild unavailable):', e.message)
  process.exit(0)
}

const {
  sha256Hex,
  extOf,
  fileFamily,
  imageMediaType,
  densityConfidence,
  reconstructPageText,
  pagesFromModelText,
  joinPageText,
} = mod

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) {
    pass++
    console.log('  ✓', msg)
  } else {
    fail++
    console.log('  ✗', msg)
  }
}

console.log('extract — dedup hashing')
{
  const a = sha256Hex(Buffer.from('hello world'))
  const b = sha256Hex(Buffer.from('hello world'))
  const c = sha256Hex(Buffer.from('hello worlD'))
  ok(a === b, 'identical bytes hash identically (dedup key is stable)')
  ok(a !== c, 'different bytes hash differently')
  ok(/^[0-9a-f]{64}$/.test(a), 'hash is 64 hex chars (sha-256)')
}

console.log('extract — format detection')
{
  ok(extOf('Report.PDF') === 'pdf', 'extOf lowercases the extension')
  ok(extOf('noext') === '', 'extOf returns empty when no extension')
  ok(fileFamily('pdf') === 'pdf', 'pdf → pdf family')
  ok(fileFamily('csv') === 'text' && fileFamily('md') === 'text', 'csv/md → text family')
  ok(fileFamily('png') === 'image' && fileFamily('jpeg') === 'image', 'png/jpeg → image family')
  ok(fileFamily('exe') === 'unsupported', 'unknown → unsupported family')
  ok(imageMediaType('png') === 'image/png' && imageMediaType('jpg') === 'image/jpeg', 'image media types map')
}

console.log('extract — confidence heuristic')
{
  const dense = densityConfidence(4000, 5) // 800 chars/page
  ok(dense.low === false && dense.confidence >= 0.9, 'dense text → high confidence, not low')
  const sparse = densityConfidence(100, 5) // 20 chars/page
  ok(sparse.low === true, 'near-empty pages → low_confidence (routes to OCR/human review)')
  ok(densityConfidence(0, 0).low === true, 'zero pages → low_confidence (never divide-by-zero)')
}

console.log('extract — page reconstruction')
{
  const page = {
    width: 8,
    height: 11,
    glyphs: [
      { x: 1, y: 1, end: 1.5, s: 'Risk' },
      { x: 2, y: 1, end: 2.4, s: 'Tolerance' },
      { x: 1, y: 2, end: 1.6, s: 'Moderate' },
    ],
  }
  const text = reconstructPageText(page)
  ok(text.includes('Risk Tolerance'), 'glyphs on one line join with a space at a gap')
  ok(/Risk Tolerance\nModerate/.test(text), 'a new y-line becomes a newline (reading order preserved)')
}

console.log('extract — model-vision page splitting')
{
  const raw = '===== PAGE 1 =====\nfirst page text\n\n===== PAGE 2 =====\nsecond page text'
  const pages = pagesFromModelText(raw)
  ok(pages.length === 2, 'page markers split into two pages')
  ok(pages[0].page_number === 1 && pages[1].page_number === 2, 'page numbers preserved from markers')
  ok(pages[0].text === 'first page text', 'page 1 text captured without the marker')
  const single = pagesFromModelText('no markers here')
  ok(single.length === 1 && single[0].page_number === 1, 'no markers → single page 1 fallback')
}

console.log('extract — page joining')
{
  const pages = [
    { page_number: 1, text: 'alpha' },
    { page_number: 2, text: 'beta' },
  ]
  ok(joinPageText(pages) === 'alpha\n\nbeta', 'joinPageText concatenates page text')
}

console.log(`\ncompliance-extract: ${pass} passed, ${fail} failed.`)
process.exit(fail === 0 ? 0 : 1)
