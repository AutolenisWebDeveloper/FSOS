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

// ── Premium structural rendering (elite campaign email redesign) ──────────────
// A realistic personalized campaign body carrying the full structural vocabulary the seed
// migrations use: Subject + Preview headers, greeting, a "* " bullet list, a "Label <url>" CTA,
// a "Warm regards, {name} {agency} {phone} {email}" sign-off, and a trailing disclaimer.
const STRUCTURED_BODY =
  'Subject: When Did You Last Review Your Coverage?\n' +
  'Preview: A quick review can help ensure your coverage still fits.\n\n' +
  'Hi Jordan,\n\n' +
  'Many people go years without reviewing their life insurance needs.\n\n' +
  'Your needs may change because of:\n\n' +
  '* Marriage\n* Children\n* A new home\n\n' +
  'Schedule a Complimentary Review https://www.markistfsa.com/book/markist\n\n' +
  'Warm regards, Markist Athelus Athelus Insurance Agency (253) 242-0597 mathelus@farmersagent.com\n\n' +
  'This email is educational and is not a recommendation regarding any specific policy.'

t('surfaces the body Subject line as an H1 headline (premium hierarchy)', () => {
  const html = S.wrapMarketingEmailBody(STRUCTURED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(/<h1[^>]*>\s*When Did You Last Review Your Coverage\?\s*<\/h1>/.test(html), 'subject rendered as H1')
  assert.ok(!/Subject:/i.test(html.slice(html.indexOf('<h1'))), 'no literal "Subject:" prefix in the body')
})

t('uses the body Preview line as the inbox preheader', () => {
  const html = S.wrapMarketingEmailBody(STRUCTURED_BODY, { preheader: 'fallback' })
  assert.ok(html.includes('A quick review can help ensure your coverage still fits'), 'preview text present as preheader')
})

t('renders a "* " list as a real bullet list, not run-together text', () => {
  const html = S.wrapMarketingEmailBody(STRUCTURED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(html.includes('&bull;'), 'brand bullet markers rendered')
  assert.ok(html.includes('>Marriage<') && html.includes('>Children<') && html.includes('>A new home<'), 'each item is its own row')
  assert.ok(!html.includes('* Marriage'), 'raw "* " markers are consumed, not shown')
})

t('renders a "Label <url>" line as a bulletproof CTA button', () => {
  const html = S.wrapMarketingEmailBody(STRUCTURED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(html.includes('<!--[if mso]>'), 'Outlook VML shim present (bulletproof button)')
  assert.ok(
    /<a href="https:\/\/www\.markistfsa\.com\/book\/markist"[^>]*>Schedule a Complimentary Review<\/a>/.test(html),
    'CTA label + href rendered as a button anchor',
  )
})

t('renders ONE rich branded signature for an in-body sign-off (keeps the closer word)', () => {
  const html = S.wrapMarketingEmailBody(STRUCTURED_BODY, { unsubscribeUrl: UNSUB })
  const closers = (html.match(/Warm regards,/g) || []).length
  assert.equal(closers, 1, 'exactly one sign-off (no double signature)')
  // The message's own approved closer is kept; the plain token run is replaced by the rich block.
  assert.ok(html.includes('Markist Athelus') && html.includes('FSCP'), 'name + designation in the signature')
  assert.ok(html.includes('Farmers Financial Solutions'), 'financial firm in the signature')
  assert.ok(html.includes('Life Insurance &amp; Financial Services Agent') || html.includes('Life Insurance & Financial Services Agent'), 'descriptive title')
})

t('the signature carries the headshot, canonical contacts, and green-zone action links', () => {
  const html = S.wrapMarketingEmailBody(STRUCTURED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(html.includes('markist-headshot.jpg'), 'approved headshot asset referenced')
  assert.ok(html.includes('href="tel:+19547562609"'), 'cell linkified from canonical identity')
  assert.ok(html.includes('href="tel:+13617174215"'), 'office linkified from canonical identity')
  assert.ok(html.includes('href="mailto:mathelus@farmersagent.com"'), 'email linkified')
  assert.ok(html.includes('(954) 756-2609') && html.includes('(361) 717-4215'), 'phones formatted for display')
  assert.ok(html.includes('href="https://www.markistfsa.com/schedule"') && /Schedule a Meeting with Me/.test(html), 'booking action link')
  assert.ok(html.includes('href="https://agents.farmers.com/tx/plano/markist-athelus/"') && /Get a Free Quote/.test(html), 'quote action link')
})

t('appends the same rich signature when the body has none', () => {
  const html = S.wrapMarketingEmailBody('Hi Jordan,\n\nA quick educational note about coverage.', { unsubscribeUrl: UNSUB })
  assert.ok(/Warm regards,/.test(html), 'default sign-off appended for a body without one')
  assert.ok(html.includes('Markist Athelus') && html.includes('markist-headshot.jpg'), 'rich signature (name + headshot) appended')
})

t('drops the redundant per-campaign disclaimer (superseded by footprint + CAN-SPAM footer)', () => {
  const html = S.wrapMarketingEmailBody(STRUCTURED_BODY, { unsubscribeUrl: UNSUB })
  // The body's own trailing disclaimer is NOT rendered as a body block...
  assert.ok(!/This email is educational and is not a recommendation/i.test(html), 'per-campaign disclaimer dropped')
  // ...but the required disclosures are still carried by the CAN-SPAM footer.
  assert.ok(/educational and informational purposes only/i.test(html), 'CAN-SPAM educational disclaimer retained')
  assert.ok(html.includes('Plano') && html.includes('75024'), 'physical mailing address retained')
  assert.ok(/Unsubscribe from marketing emails/i.test(html), 'unsubscribe retained')
})

t('renders the standard FSA signature footprint (tagline + offerings + disclosures)', () => {
  const html = S.wrapMarketingEmailBody(STRUCTURED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(html.includes('protect what matters most with life insurance'), 'practice tagline')
  assert.ok(html.includes('529 College Savings Plans') && html.includes('<strong'), 'offerings list with label')
  assert.ok(html.includes('Member FINRA &amp; SIPC'), 'FINRA/SIPC securities disclosure (ampersand escaped)')
  assert.ok(html.includes('intended for the recipient named above'), 'confidentiality line')
  // Footprint is green-zone identity copy — no product/securities call-to-action.
  assert.ok(!/\byou\s+should\s+(buy|purchase|invest)\b/i.test(html), 'no product call-to-action in the footprint')
})

t('carries the responsive + dark-mode progressive-enhancement style block', () => {
  const html = S.wrapMarketingEmailBody(STRUCTURED_BODY, { unsubscribeUrl: UNSUB })
  assert.ok(/@media only screen and \(max-width:600px\)/.test(html), 'mobile padding media query')
  assert.ok(/prefers-color-scheme:dark/.test(html), 'dark-mode hint')
  assert.ok(html.includes('class="fsos-card"') && html.includes('class="fsos-pad"'), 'responsive class hooks present')
})

t('adds no recommendation / call-to-action language via the chrome', () => {
  const html = S.wrapMarketingEmailBody('Hi Jordan, a quick educational note about coverage.', { unsubscribeUrl: UNSUB })
  assert.ok(!/\b(i|we)\s+recommend\b/i.test(html), 'no "we recommend" in chrome')
  assert.ok(!/\byou\s+should\s+(buy|purchase|invest|convert|replace)\b/i.test(html), 'no product call-to-action')
})

console.log(`\n✅ email-marketing-wrap: ${passed} passed`)
