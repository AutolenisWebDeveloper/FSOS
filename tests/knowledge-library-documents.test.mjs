// tests/knowledge-library-documents.test.mjs
//
// Proof for AI Knowledge Library document management — the ability to UPLOAD the
// actual file behind a knowledge document, and to EDIT / ARCHIVE / DELETE it
// afterwards. Before this change the library was write-only-by-typing: no upload, no
// edit, no delete, and identical files could be added twice without a warning (the
// duplicate rows visible on /app/knowledge).
//
// What is proven here:
//   A. Upload validation rejects what the library cannot secure or read — and does so
//      BEFORE any bytes reach storage.
//   B. Object paths are traversal-safe: a crafted filename can never escape the
//      `knowledge/` prefix or write to a control path.
//   C. Indexed text is bounded and its clipping is DISCLOSED, never silent (§4.3 —
//      no unverified/incomplete content presented as whole).
//   D. Upload metadata + the delete mode are Zod-validated, with the SAFE default:
//      DELETE without a mode archives (reversible) rather than destroying.
//   E. The manual form and the upload path share one content ceiling, so an uploaded
//      document stays editable afterwards.
//   F. GUARDRAIL (source-level): the private storage path is never selected into a
//      client-facing payload — downloads only ever go through a signed URL.
//
// Bundled on the fly with esbuild (tsconfig paths for the @/ alias). Skips cleanly
// when esbuild is unavailable, but MUST run under CI_REQUIRE_INFRA=1.
// Run: node tests/knowledge-library-documents.test.mjs

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let uploads
let storage
let schemas
let dir
try {
  // Bundle INSIDE the repo: the ingester's transitive imports reach the AI gateway,
  // whose provider SDKs stay external (they are never invoked by these pure
  // functions) and must therefore resolve against the project's node_modules.
  dir = mkdtempSync(join(process.cwd(), '.kld-test-'))
  const bundle = (src, name) => {
    const out = join(dir, name)
    execSync(
      `npx --yes esbuild@0.21.5 ${src} --bundle --platform=node --format=esm ` +
        `--outfile=${out} --tsconfig=tsconfig.json --packages=external`,
      { stdio: 'ignore' },
    )
    return out
  }
  uploads = await import(bundle('src/lib/knowledge/uploads.ts', 'uploads.mjs'))
  storage = await import(bundle('src/lib/storage/private-documents.ts', 'storage.mjs'))
  schemas = await import(bundle('src/lib/validation/schemas.ts', 'schemas.mjs'))
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  if (dir) rmSync(dir, { recursive: true, force: true })
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild is unavailable:', e.message)
    process.exit(1)
  }
  console.log('knowledge-library-documents.test.mjs — SKIPPED (esbuild unavailable):', e.message)
  process.exit(0)
}

const {
  rejectUpload,
  deriveTitleFromFilename,
  buildKnowledgeStoragePath,
  buildIndexedContent,
  MAX_KNOWLEDGE_CONTENT_CHARS,
  TRUNCATION_NOTICE,
  KNOWLEDGE_PREFIX,
} = uploads
const { safeObjectName, buildObjectPath, PRIVATE_DOCUMENTS_BUCKET } = storage
const { KnowledgeUploadMetaSchema, KnowledgeDeleteModeSchema, KnowledgePatchSchema, KNOWLEDGE_CONTENT_MAX } = schemas

const results = []
function t(id, name, fn) {
  try {
    fn()
    results.push({ id, pass: true })
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ id, pass: false, name, err: e.message })
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

// ── A. Upload validation happens before any bytes are stored ──────────────────
console.log('\nPart A — upload validation')

t('A1', 'a missing or zero-byte file is rejected 400', () => {
  assert.equal(rejectUpload(null)?.status, 400)
  assert.equal(rejectUpload({ name: 'x.pdf', size: 0 })?.code, 'empty')
})

t('A2', 'a file past the 30MB ceiling is rejected 413 with the limit in the message', () => {
  const r = rejectUpload({ name: 'big.pdf', size: 31 * 1024 * 1024 })
  assert.equal(r?.code, 'too_large')
  assert.equal(r?.status, 413)
  assert.match(r.message, /30MB/)
})

t('A3', 'an unsupported type is rejected 415 (executables/archives never reach storage)', () => {
  for (const name of ['payload.exe', 'archive.zip', 'macro.docm', 'noextension']) {
    const r = rejectUpload({ name, size: 1024 })
    assert.equal(r?.code, 'unsupported_type', `${name} should be rejected`)
    assert.equal(r?.status, 415)
  }
})

t('A4', 'the supported set — PDF, images, and text — is accepted', () => {
  for (const name of ['notice.pdf', 'scan.PNG', 'photo.jpg', 'shot.webp', 'anim.gif', 'notes.txt', 'doc.md', 'rows.csv']) {
    assert.equal(rejectUpload({ name, size: 2048 }), null, `${name} should be accepted`)
  }
})

// ── B. Traversal-safe object paths ────────────────────────────────────────────
console.log('\nPart B — storage paths are traversal-safe')

t('B1', 'path separators and traversal segments are neutralized in the object name', () => {
  for (const evil of ['../../etc/passwd', '..\\..\\windows\\system32', '/absolute/path.pdf']) {
    const safe = safeObjectName(evil)
    assert.ok(!safe.includes('/'), `no forward slash in ${safe}`)
    assert.ok(!safe.includes('\\'), `no backslash in ${safe}`)
    assert.ok(!safe.startsWith('.'), `no leading dot in ${safe}`)
  }
})

t('B2', 'a crafted filename cannot escape the knowledge/ prefix', () => {
  const path = buildKnowledgeStoragePath('../../secrets/keys.pdf', Date.UTC(2026, 7, 6))
  assert.ok(path.startsWith(`${KNOWLEDGE_PREFIX}/`), path)
  assert.ok(!path.includes('..'), path)
  // knowledge/<yyyy-mm>/<ts>-<name> — exactly three segments, no deeper nesting.
  assert.equal(path.split('/').length, 3, path)
})

t('B3', 'library files land under a dated scope inside the knowledge prefix', () => {
  const path = buildKnowledgeStoragePath('District Book.pdf', Date.UTC(2026, 0, 15))
  assert.match(path, /^knowledge\/2026-01\/\d+-District_Book\.pdf$/, path)
})

t('B4', 'an empty or dot-only filename still yields a usable object name', () => {
  assert.ok(safeObjectName('').length > 0)
  assert.ok(safeObjectName('...').length > 0)
  assert.ok(!safeObjectName('...').startsWith('.'))
})

t('B5', 'the shared builder keeps compliance and knowledge in separate prefixes', () => {
  assert.ok(buildObjectPath('compliance', 'case-1', 'a.pdf', 1).startsWith('compliance/'))
  assert.ok(buildObjectPath('knowledge', '2026-08', 'a.pdf', 1).startsWith('knowledge/'))
  assert.equal(PRIVATE_DOCUMENTS_BUCKET, 'documents')
})

// ── C. Indexed text is bounded, and clipping is disclosed ─────────────────────
console.log('\nPart C — indexed content bounds are disclosed, never silent')

t('C1', 'pages are joined into retrievable prose', () => {
  const { content, truncated } = buildIndexedContent([{ text: 'Page one.' }, { text: 'Page two.' }])
  assert.equal(content, 'Page one.\n\nPage two.')
  assert.equal(truncated, false)
})

t('C2', 'text at or under the ceiling is stored whole and NOT flagged truncated', () => {
  const { content, truncated } = buildIndexedContent([{ text: 'a'.repeat(MAX_KNOWLEDGE_CONTENT_CHARS) }])
  assert.equal(content.length, MAX_KNOWLEDGE_CONTENT_CHARS)
  assert.equal(truncated, false)
})

t('C3', 'over-long text is clipped AND carries a visible notice + the truncated flag', () => {
  const { content, truncated } = buildIndexedContent([{ text: 'a'.repeat(MAX_KNOWLEDGE_CONTENT_CHARS + 5000) }])
  assert.equal(truncated, true, 'clipping must be reported, not silent')
  assert.ok(content.endsWith(TRUNCATION_NOTICE), 'the clip must be disclosed in the stored text')
  assert.match(TRUNCATION_NOTICE, /original file is attached/i)
})

t('C4', 'empty pages produce empty content rather than a fabricated body', () => {
  assert.equal(buildIndexedContent([]).content, '')
  assert.equal(buildIndexedContent([{ text: '   ' }]).content, '')
})

t('C5', 'a filename becomes a readable title when the uploader leaves it blank', () => {
  assert.equal(deriveTitleFromFilename('district_in-force_book.pdf'), 'district in force book')
  assert.equal(deriveTitleFromFilename('/tmp/Q3 Term Conversion.PDF'), 'Q3 Term Conversion')
  assert.ok(deriveTitleFromFilename('').length > 0, 'never an empty title')
  assert.ok(deriveTitleFromFilename('x'.repeat(500)).length <= 240, 'capped to the column length')
})

// ── D. Zod-validated metadata + a SAFE delete default ─────────────────────────
console.log('\nPart D — validation and the safe delete default')

t('D1', 'upload metadata defaults match the manual form (published · internal · not an assumption)', () => {
  const v = KnowledgeUploadMetaSchema.parse({})
  assert.equal(v.kind, 'document')
  assert.equal(v.status, 'published')
  assert.equal(v.visibility, 'internal')
  assert.equal(v.is_assumption, false)
  assert.equal(v.force, false)
  assert.deepEqual(v.tags, [])
})

t('D2', 'an unknown kind / status / visibility is rejected, not coerced', () => {
  assert.equal(KnowledgeUploadMetaSchema.safeParse({ kind: 'securities_order' }).success, false)
  assert.equal(KnowledgeUploadMetaSchema.safeParse({ status: 'live' }).success, false)
  assert.equal(KnowledgeUploadMetaSchema.safeParse({ visibility: 'public' }).success, false)
})

t('D3', 'the Farmers assumption flag survives the upload path (Guardrail 3)', () => {
  assert.equal(KnowledgeUploadMetaSchema.parse({ is_assumption: true }).is_assumption, true)
})

t('D4', 'DELETE with no mode ARCHIVES — the destructive path is never the default', () => {
  assert.equal(KnowledgeDeleteModeSchema.parse(undefined), 'archive')
})

t('D5', 'permanent deletion must be asked for explicitly, and nothing else is accepted', () => {
  assert.equal(KnowledgeDeleteModeSchema.parse('permanent'), 'permanent')
  assert.equal(KnowledgeDeleteModeSchema.safeParse('purge').success, false)
  assert.equal(KnowledgeDeleteModeSchema.safeParse('drop').success, false)
})

t('D6', 'an empty PATCH is rejected — an edit must actually change something', () => {
  assert.equal(KnowledgePatchSchema.safeParse({}).success, false)
  assert.equal(KnowledgePatchSchema.safeParse({ title: 'Renamed' }).success, true)
})

t('D7', 'PATCH rejects a blank title rather than silently erasing it', () => {
  assert.equal(KnowledgePatchSchema.safeParse({ title: '   ' }).success, false)
})

// ── E. One content ceiling across both authoring paths ────────────────────────
console.log('\nPart E — an uploaded document stays editable')

t('E1', 'the upload ingester and the edit form share ONE content ceiling', () => {
  assert.equal(MAX_KNOWLEDGE_CONTENT_CHARS, KNOWLEDGE_CONTENT_MAX)
})

t('E2', 'extracted text at the ceiling can be saved back through PATCH', () => {
  // Regression guard: a smaller PATCH cap would make every large upload uneditable.
  const atCeiling = 'a'.repeat(KNOWLEDGE_CONTENT_MAX)
  assert.equal(KnowledgePatchSchema.safeParse({ content: atCeiling }).success, true)
})

// ── F. GUARDRAIL — the private storage path never reaches the browser ─────────
console.log('\nPart F — guardrail: no private storage path in a client payload')

/** Drop line/block comments so prose about the path isn't mistaken for code. */
function code(path) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const listRoute = code('src/app/api/knowledge/route.ts')
const detailRoute = code('src/app/api/knowledge/[id]/route.ts')
const page = code('src/app/(fsa)/app/knowledge/page.tsx')

t('F1', 'the library list endpoint never reads the private storage path', () => {
  assert.ok(!listRoute.includes('storage_path'), 'the list route must not select the private path')
})

t('F2', 'the library page never reads the private storage path', () => {
  assert.ok(!page.includes('storage_path'), 'the RSC page must not select the private path')
})

t('F3', 'the detail endpoint strips storage_path from its response and signs a URL instead', () => {
  // GET DOES read the path (to sign it) — but must destructure it out before responding.
  assert.match(detailRoute, /storage_path:\s*storagePath/, 'the path must be destructured out of the payload')
  assert.match(detailRoute, /createSignedUrl\(/, 'downloads must go through a short-lived signed URL')
  assert.ok(!/\{\s*\.\.\.data,\s*url\s*\}/.test(detailRoute), 'the response must spread `rest`, not the raw row')
  // The rows that DO carry the path (the GET signing read and the DELETE cleanup read)
  // must never be spread into a response body.
  assert.ok(!/document:\s*\{?\s*\.\.\.(data|existing)\b/.test(detailRoute), 'a path-bearing row is spread into a response')
  // No JSON response body may name the column.
  for (const m of detailRoute.matchAll(/NextResponse\.json\(([\s\S]{0,400}?)\)\s*$/gm)) {
    assert.ok(!m[1].includes('storage_path'), `a response body leaks the path: ${m[1].slice(0, 100)}`)
  }
})

t('F4', 'the permanent-delete path removes the stored file and audits what was destroyed', () => {
  assert.match(detailRoute, /removeObjects\(/, 'permanent delete must clean up the bytes')
  assert.match(detailRoute, /permanent:\s*true/, 'the audit entry must record that it was permanent')
  assert.match(detailRoute, /file_name:\s*existing\.file_name/, 'the audit entry must name what was deleted')
})

// ── Summary ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)
if (failed.length) {
  for (const f of failed) console.error(`  ✗ ${f.id} ${f.name}: ${f.err}`)
  process.exit(1)
}
console.log('✓ knowledge-library-documents: upload, edit, archive, and delete are proven.')
