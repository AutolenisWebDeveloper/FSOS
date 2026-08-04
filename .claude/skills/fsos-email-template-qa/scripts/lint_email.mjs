#!/usr/bin/env node
// lint_email.mjs — lint an FSOS email TEMPLATE (HTML) for deliverability + a11y signals.
//
// Reports: image-to-text ratio, link count, spam/finance trigger-word density, alt-text
// coverage, plain-text-part guidance, unsubscribe / List-Unsubscribe signal (judged by
// --stream), and responsive + dark-mode readiness. Dependency-free (regex HTML scan),
// reads only the file you pass, takes NO secrets, writes nothing to disk.
//
// Usage:
//   node lint_email.mjs <template.html> [--stream=marketing|transactional] [--json]
//   node lint_email.mjs --self-test        # offline: lint two built-in fixtures
//
// Exit code: 0 = no FAIL · 1 = at least one FAIL · 2 = usage error.

import { readFileSync } from 'node:fs';

// Finance / urgency / spam trigger words — deliverability AND compliance (Reg BI) smells.
const TRIGGERS = [
  'free', 'guarantee', 'guaranteed', 'risk-free', 'risk free', 'act now', 'limited time',
  'urgent', 'winner', 'congratulations', 'cash', 'double your', 'no obligation', '100%',
  'once in a lifetime', 'wire funds', 'wire transfer', 'best rates', 'lowest price',
  'click here', 'buy now', 'order now', 'exclusive deal', 'get rich', 'earn extra',
  'investment returns', 'high yield', 'no risk', 'pre-approved', 'apply now', 'why pay more',
];

function parseArgs(argv) {
  const a = { file: null, stream: null, json: false, selfTest: false, help: false };
  for (const x of argv.slice(2)) {
    if (x === '--json') a.json = true;
    else if (x === '--self-test') a.selfTest = true;
    else if (x === '-h' || x === '--help') a.help = true;
    else if (x.startsWith('--stream=')) a.stream = x.slice(9).trim().toLowerCase();
    else if (!x.startsWith('--') && !a.file) a.file = x;
  }
  return a;
}

// ─────────────────── pure analyzer (testable, no I/O) ───────────────────
function analyze(html, stream) {
  const findings = [];
  const add = (status, check, detail) => findings.push({ status, check, detail });

  // Visible text: drop scripts/styles/comments/head, strip tags, collapse whitespace.
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ');
  const text = body.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').filter(Boolean).length : 0;

  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter(t => !/\balt\s*=\s*["'][^"']*\S[^"']*["']/i.test(t));
  const links = html.match(/<a\b[^>]*\bhref\s*=\s*["'][^"']+["']/gi) || [];
  const httpLinks = links.filter(l => /https?:\/\//i.test(l));

  // Metrics
  const ratio = words > 0 ? +(imgs.length / (words / 100)).toFixed(2) : (imgs.length ? Infinity : 0);
  const lowerText = text.toLowerCase();
  const hits = [];
  for (const t of TRIGGERS) {
    const re = new RegExp(`\\b${t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
    const n = (lowerText.match(re) || []).length;
    if (n) hits.push({ term: t, n });
  }
  const triggerTotal = hits.reduce((s, h) => s + h.n, 0);
  const density = words > 0 ? +((triggerTotal / words) * 100).toFixed(2) : 0;

  const metrics = {
    words, images: imgs.length, imagesMissingAlt: imgsNoAlt.length,
    links: links.length, imageToTextPer100Words: ratio, triggerHits: triggerTotal,
    triggerDensityPer100Words: density,
  };

  // ── Image-to-text ratio ──
  // FAIL only when the email is genuinely text-less/image-carried (near-empty text with
  // images, or many images swamping the copy) — a short note with a single logo is fine.
  if ((words < 20 && imgs.length >= 1) || (imgs.length >= 5 && ratio > 3)) {
    add('FAIL', 'image:text', `${words} words of real text vs ${imgs.length} image(s) — image-heavy/text-light is the classic Promotions/spam pattern and breaks when images are blocked`);
  } else if (ratio > 3 || (imgs.length >= 3 && words < 120)) {
    add('WARN', 'image:text', `${ratio} images per 100 words (${imgs.length} img / ${words} words) — lean toward more real text`);
  } else {
    add('PASS', 'image:text', `${imgs.length} image(s) / ${words} words (ratio ${ratio}/100w)`);
  }

  // ── Alt-text coverage ──
  if (imgs.length === 0) add('PASS', 'alt-text', 'no images');
  else if (imgsNoAlt.length) add('FAIL', 'alt-text', `${imgsNoAlt.length}/${imgs.length} <img> missing alt — WCAG 2.2 AA fail and unreadable when images are blocked`);
  else add('PASS', 'alt-text', `all ${imgs.length} image(s) have alt`);

  // ── Link count ──
  const linkCeiling = stream === 'transactional' ? 5 : 20;
  if (links.length > linkCeiling) add('WARN', 'links', `${links.length} links (>${linkCeiling} for ${stream || 'unknown'} stream) — high link count reads as bulk marketing`);
  else add('PASS', 'links', `${links.length} link(s)`);

  // ── Trigger words ──
  if (density >= 2 || triggerTotal >= 4) add('FAIL', 'trigger-words', `${triggerTotal} hit(s), density ${density}/100w — ${hits.slice(0, 8).map(h => `${h.term}×${h.n}`).join(', ')}. Raises spam score; "guarantee"/returns language can also breach Reg BI / the AI red-line`);
  else if (triggerTotal) add('WARN', 'trigger-words', `${triggerTotal} hit(s): ${hits.map(h => `${h.term}×${h.n}`).join(', ')}`);
  else add('PASS', 'trigger-words', 'no common trigger words');

  // ── Plain-text part (can't see it from HTML alone) ──
  add('WARN', 'plain-text', 'the HTML file cannot prove a text/plain part exists — ensure the template\'s stored body_text is authored (FSOS send.ts SendContext.bodyText, ADR-025). A missing plain-text alternative is a spam signal.');

  // ── Unsubscribe / List-Unsubscribe (stream-dependent) ──
  const hasUnsub = /unsubscribe|list-unsubscribe|opt[\s-]?out/i.test(html);
  const hasPostal = /\b\d{3,}\b[^<]{0,40}(TX|Texas|McKinney)/i.test(text) || /P\.?O\.? Box/i.test(text);
  if (stream === 'marketing') {
    if (hasUnsub) add('PASS', 'unsubscribe', 'unsubscribe present (required for marketing; also ensure the RFC 8058 List-Unsubscribe header ships via unsubscribe.ts emailListUnsubscribeHeaders())');
    else add('FAIL', 'unsubscribe', 'marketing mail MUST include an unsubscribe (CAN-SPAM) — and the RFC 8058 one-click header');
    if (!hasPostal) add('WARN', 'postal-address', 'no physical postal address detected — CAN-SPAM requires one in marketing mail');
  } else if (stream === 'transactional') {
    if (hasUnsub) add('WARN', 'unsubscribe', 'unsubscribe/List-Unsubscribe on TRANSACTIONAL mail is a Promotions-tab signal — relationship-class mail should not carry it (see fsos-deliverability)');
    else add('PASS', 'unsubscribe', 'no unsubscribe chrome (correct for transactional)');
  } else {
    add('INFO', 'unsubscribe', `unsubscribe ${hasUnsub ? 'present' : 'absent'} — pass --stream to judge (required for marketing, a Promotions signal for transactional)`);
  }

  // ── Responsive readiness ──
  const hasViewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(html);
  const hasMedia = /@media\b/i.test(html);
  if (hasViewport || hasMedia) add('PASS', 'responsive', `${[hasViewport && 'viewport meta', hasMedia && 'media queries'].filter(Boolean).join(' + ')} present`);
  else add('WARN', 'responsive', 'no viewport meta or media queries — may not render well on mobile (where most of this book reads mail)');

  // ── Dark-mode readiness ──
  if (/prefers-color-scheme/i.test(html)) add('PASS', 'dark-mode', 'prefers-color-scheme handling present');
  else add('WARN', 'dark-mode', 'no prefers-color-scheme handling — Gmail/Apple dark mode may invert colors unreadably');

  return { metrics, findings };
}

// ─────────────────── rendering ───────────────────
function render(name, stream, result, json) {
  const { metrics, findings } = result;
  const hardFail = findings.some(f => f.status === 'FAIL');
  if (json) {
    console.log(JSON.stringify({ template: name, stream: stream || 'unknown', metrics, findings, ok: !hardFail }, null, 2));
  } else {
    const icon = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ', INFO: 'ℹ️ ' };
    console.log(`\nEmail template lint — ${name}   [stream: ${stream || 'unknown'}]\n${'─'.repeat(66)}`);
    console.log(`words ${metrics.words} · images ${metrics.images} (no-alt ${metrics.imagesMissingAlt}) · links ${metrics.links} · trigger density ${metrics.triggerDensityPer100Words}/100w`);
    console.log('─'.repeat(66));
    for (const f of findings) console.log(`${icon[f.status] || '  '} ${f.check.padEnd(14)} ${f.detail}`);
    console.log('─'.repeat(66));
    console.log(hardFail ? '❌ FAIL — resolve the ❌ findings before shipping this template.' : '✅ No hard failures. (Review any ⚠️  warnings.)');
  }
  return hardFail;
}

// ─────────────────── offline self-test ───────────────────
function selfTest() {
  const promo = `<html><body>
    <img src="hero.png"><img src="cta.png"><img src="logo.png">
    <h1>ACT NOW — GUARANTEED investment returns, 100% risk-free!</h1>
    <a href="http://x/1">click here</a><a href="http://x/2">buy now</a>
    <p>Limited time exclusive deal. <a href="#unsubscribe">unsubscribe</a></p>
    </body></html>`;
  const clean = `<!doctype html><html lang="en"><head>
    <meta name="viewport" content="width=device-width">
    <style>@media(max-width:600px){.c{width:100%}} @media (prefers-color-scheme: dark){body{background:#111}}</style>
    </head><body>
    <p>Hi {{first_name}}, your annual policy review is confirmed for Tuesday at 2pm.
    Here is the secure form to complete beforehand. Reply to this email with any questions —
    we look forward to reviewing your coverage and answering whatever comes up for your household.</p>
    <img src="logo.png" alt="Markist Athelus, Farmers Financial Services">
    <a href="https://markistfsa.com/forms/abc">Open your review form</a>
    </body></html>`;
  console.log('lint_email self-test (offline fixtures)');
  console.log('\n### Fixture 1: promotional/spammy, linted as TRANSACTIONAL (should FAIL) ###');
  const f1 = render('fixture:promo.html', 'transactional', analyze(promo, 'transactional'), false);
  console.log('\n### Fixture 2: clean transactional review confirmation (should PASS) ###');
  const f2 = render('fixture:clean.html', 'transactional', analyze(clean, 'transactional'), false);
  const ok = f1 === true && f2 === false;
  console.log(`\n${ok ? '✅' : '❌'} self-test ${ok ? 'passed' : 'FAILED'} (fixture1 expected FAIL, fixture2 expected PASS)`);
  process.exit(ok ? 0 : 1);
}

// ─────────────────── main ───────────────────
function main() {
  const a = parseArgs(process.argv);
  if (a.help) { console.log('Usage: node lint_email.mjs <template.html> [--stream=marketing|transactional] [--json] | --self-test'); process.exit(0); }
  if (a.selfTest) return selfTest();
  if (!a.file) { console.error('Error: <template.html> required (or --self-test). See --help.'); process.exit(2); }
  if (a.stream && !['marketing', 'transactional'].includes(a.stream)) { console.error(`Error: --stream must be marketing|transactional (got "${a.stream}")`); process.exit(2); }
  let html;
  try { html = readFileSync(a.file, 'utf8'); }
  catch (e) { console.error(`Cannot read ${a.file}: ${e.code || e.message}`); process.exit(2); }
  const hardFail = render(a.file, a.stream, analyze(html, a.stream), a.json);
  process.exit(hardFail ? 1 : 0);
}

main();
