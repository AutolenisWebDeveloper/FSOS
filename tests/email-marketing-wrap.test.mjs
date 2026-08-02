// Send-time marketing email wrap (DESIGN.md §31). Proves the runtime branded shell that
// makes EVERY campaign email premium: a plain-text campaign body (library blueprint or seed
// migration) is wrapped in the Farmers-branded shell with a CAN-SPAM marketing footer, while
// a body that is already a full HTML document (react-email templates) is passed through
// untouched. Bundled with esbuild (installed devDep, no network). Run:
//   node tests/email-marketing-wrap.test.mjs
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const out = mkdtempSync(join(tmpdir(), 'fsos-mktwrap-'))
const outfile = join(out, 'shell.cjs')
await build({
  entryPoints: ['src/lib/notifications/email-shell.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile,
  logLevel: 'silent',
  plugins: [
    {
      name: 'alias',
      setup(b) {
        b.onResolve({ filter: /^@\// }, (a) => {
          const rel = a.path.slice(2)
          for (const ext of ['.ts', '.tsx', '/index.ts']) {
            const p = join(root, 'src', rel + ext)
            try {
              readFileSync(p)
              return { path: p }
            } catch {
              /* next */
            }
          }
          return { path: join(root, 'src', rel + '.ts') }
        })
      },
    },
  ],
})
const require = createRequire(pathToFileURL(join(root, 'x')).href)
const S = require(outfile)

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('marketing email wrap (DESIGN.md §31)')

// A realistic personalized plain-text campaign body (as stored by a seed migration / library
// blueprint, after personalize() resolved the recipient values). Note the leading "Subject:"
// line some seed bodies carry, and a bare {{scheduling_link}}-resolved URL.
const PERSONALIZED_BODY =
  'Subject: Let us review your coverage\n\n' +
  'Hi Jordan, it has been a little while since we last reviewed your coverage together.\n\n' +
  'Schedule your review https://www.markistfsa.com/schedule\n\n' +
  'Warm regards, Markist Athelus'
const UNSUB = 'https://www.markistfsa.com/unsubscribe?c=jordan%40example.com&ch=email'

t('wraps a plain-text body into a full branded HTML document', () => {
  const html = S.wrapMarketingEmailBody(PERSONALIZED_BODY, { preheader: 'A quick check-in', unsubscribeUrl: UNSUB })
  assert.ok(html.includes('<!DOCTYPE html>') || /<html[\s>]/i.test(html), 'is a full HTML document')
})

t('carries the Farmers logo, the body text, and the FSA identity', () => {
  const html = S.wrapMarketingEmailBody(PERSONALIZED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(html.includes('brand/farmers-logo.png'), 'approved logo asset referenced')
  assert.ok(html.includes('it has been a little while since we last reviewed'), 'body text preserved')
  assert.ok(html.includes('Markist Athelus'), 'FSA identity present')
})

t('strips a leading "Subject:" line from the rendered body', () => {
  const html = S.wrapMarketingEmailBody(PERSONALIZED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(!/Subject:\s*Let us review/i.test(html), 'the Subject: line is not rendered in the body')
})

t('linkifies a bare absolute URL so the CTA is clickable + click-trackable', () => {
  const html = S.wrapMarketingEmailBody(PERSONALIZED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(
    html.includes('<a href="https://www.markistfsa.com/schedule"'),
    'bare scheduling URL turned into an anchor',
  )
})

t('carries the CAN-SPAM marketing footer: address + educational disclaimer + unsubscribe', () => {
  const html = S.wrapMarketingEmailBody(PERSONALIZED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(html.includes('Plano') && html.includes('75024'), 'physical mailing address (sender ID)')
  assert.ok(/educational and informational purposes only/i.test(html), 'educational disclaimer')
  // The href is attribute-escaped (& → &amp;), which is valid HTML — match either form.
  assert.ok(
    html.includes('href="https://www.markistfsa.com/unsubscribe?c=jordan%40example.com&amp;ch=email"') ||
      html.includes(`href="${UNSUB}"`),
    'per-recipient unsubscribe link wired',
  )
  assert.ok(/unsubscribe/i.test(html), 'visible unsubscribe copy')
})

t('falls back to a safe absolute unsubscribe URL when none is supplied', () => {
  const html = S.wrapMarketingEmailBody('Hi Jordan, a quick note.', {})
  assert.ok(/href="https?:\/\/[^"]+\/unsubscribe"/.test(html), 'absolute /unsubscribe fallback')
})

t('does NOT double-wrap a body that is already a full HTML document', () => {
  const fullDoc = '<!DOCTYPE html><html><body><h1>Already branded</h1></body></html>'
  assert.equal(S.wrapMarketingEmailBody(fullDoc, { unsubscribeUrl: UNSUB }), fullDoc, 'passed through unchanged')
  assert.equal(S.isFullHtmlDocument(fullDoc), true)
  assert.equal(S.isFullHtmlDocument('Hi Jordan, plain text.'), false)
})

t('adds no recommendation / call-to-action language via the chrome', () => {
  const html = S.wrapMarketingEmailBody('Hi Jordan, a quick educational note about coverage.', { unsubscribeUrl: UNSUB })
  assert.ok(!/\b(i|we)\s+recommend\b/i.test(html), 'no "we recommend" in chrome')
  assert.ok(!/\byou\s+should\s+(buy|purchase|invest|convert|replace)\b/i.test(html), 'no product call-to-action')
})

console.log(`\n✅ email-marketing-wrap: ${passed} passed`)
