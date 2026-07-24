// Slice 9B (ADR-025) — Email render DETERMINISM. The approved artifact is the STORED
// rendered HTML + plaintext; "approved" only means something if the render is reproducible.
// This test bundles the registry + render helpers with esbuild (installed devDep, no
// network) and asserts every template renders BYTE-IDENTICAL HTML + text across runs, that
// render_sha pins those bytes, and that green-zone invariants hold (no baked-in footer, no
// recommendation language, merge tokens present). Run: node tests/email-determinism.test.mjs
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const out = mkdtempSync(join(tmpdir(), 'fsos-email-'))
const outfile = join(out, 'entry.cjs')
await build({
  entryPoints: ['src/emails/_test-entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  jsx: 'automatic',
  outfile,
  logLevel: 'silent',
})
const require = createRequire(pathToFileURL(join(process.cwd(), 'tests/')).href)
const { EMAIL_TEMPLATES, renderEmailTemplate, renderSha, containsRecommendationLanguage } = require(outfile)

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }
const at = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

console.log('Email render determinism (ADR-025)')

assert.ok(Array.isArray(EMAIL_TEMPLATES) && EMAIL_TEMPLATES.length >= 1, 'registry is non-empty')

for (const tpl of EMAIL_TEMPLATES) {
  await at(`[${tpl.sourceKey}] renders byte-identical HTML + text across runs`, async () => {
    const a = await renderEmailTemplate(tpl.element)
    const b = await renderEmailTemplate(tpl.element)
    assert.equal(a.html, b.html, 'HTML must be byte-identical')
    assert.equal(a.text, b.text, 'plaintext must be byte-identical')
    assert.equal(a.sha, b.sha, 'render_sha must be stable')
  })

  await at(`[${tpl.sourceKey}] render_sha pins exactly (html, text)`, async () => {
    const r = await renderEmailTemplate(tpl.element)
    assert.equal(r.sha, renderSha(r.html, r.text), 'sha must equal the hash of the stored bytes')
    // A different byte in either part must change the sha (immutability guarantee).
    assert.notEqual(r.sha, renderSha(r.html + ' ', r.text))
    assert.notEqual(r.sha, renderSha(r.html, r.text + ' '))
  })

  await at(`[${tpl.sourceKey}] is a real, green-zone email (tokens, no baked footer, non-empty text)`, async () => {
    const { html, text } = await renderEmailTemplate(tpl.element)
    assert.ok(html.includes('<html') || html.includes('<!DOCTYPE'), 'is HTML')
    assert.ok(html.includes('{{first_name}}') || html.includes('{{fsa_name}}'), 'carries merge tokens for send-time personalization')
    assert.ok(text.trim().length > 0, 'plaintext is non-empty')
    // The dispatcher appends the TRAIGA/opt-out footer at send time — it must NOT be baked in.
    assert.ok(!/unsubscribe|reply stop|opt.?out/i.test(html), 'no baked-in opt-out footer (dispatcher adds it)')
    // §2.2 red line — no individualized recommendation / call-to-action language (build-gated).
    assert.equal(containsRecommendationLanguage(text), false, 'plaintext must be recommendation-free')
    assert.equal(containsRecommendationLanguage(html), false, 'HTML must be recommendation-free')
  })
}

console.log(`\n${passed} assertions passed across ${EMAIL_TEMPLATES.length} template(s).`)
