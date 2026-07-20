// tests/compliance-extract.test.mjs — pure logic of the Compliance Intelligence
// document pipeline (src/lib/compliance/extract.ts). Bundled to JS on the fly via
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
  renderPagesWithMarkers,
  joinPageText,
  guessKind,
  summarizeStructuredReport,
  StructuredRightBridgeSchema,
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

console.log('extract — rendering helpers')
{
  const pages = [
    { page_number: 1, text: 'alpha' },
    { page_number: 2, text: 'beta' },
  ]
  ok(renderPagesWithMarkers(pages).includes('===== PAGE 2 ====='), 'renderPagesWithMarkers emits page markers')
  ok(joinPageText(pages) === 'alpha\n\nbeta', 'joinPageText concatenates page text')
}

console.log('extract — document-kind heuristic')
{
  ok(guessKind('RightBridge Product Profiler.pdf', '') === 'rightbridge', 'filename → rightbridge')
  ok(guessKind('notice.pdf', 'This application is Not In Good Order; please provide...') === 'nigo', 'NIGO language → nigo')
  ok(guessKind('random.pdf', 'hello') === 'other', 'no signal → other')
}

console.log('extract — structured report schema + summary')
{
  const parsed = StructuredRightBridgeSchema.safeParse({
    report_version: 'v3',
    sections: [
      {
        name: 'Financial',
        page: 2,
        questions: [
          { number: '1', label: 'Net worth', answer: '$500k', page: 2, confidence: 0.9 },
          { number: '2', label: 'Liquidity need', answer: null, page: 2 },
        ],
      },
    ],
  })
  ok(parsed.success, 'a well-formed structured report validates')
  const summary = summarizeStructuredReport(parsed.success ? parsed.data : { sections: [] })
  ok(summary.section_count === 1 && summary.question_count === 2, 'summary counts sections + questions')
  ok(summary.blank_count === 1, 'blank (null) answers are counted as blanks, not fabricated')

  const bad = StructuredRightBridgeSchema.safeParse({ sections: [{ name: 'X', questions: [{ answer: 'no label' }] }] })
  ok(!bad.success, 'a question with no label is rejected (schema-validated writes)')
}

console.log(`\ncompliance-extract: ${pass} passed, ${fail} failed.`)
process.exit(fail === 0 ? 0 : 1)
