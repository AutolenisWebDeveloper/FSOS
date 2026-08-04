#!/usr/bin/env node
// validate_dns.mjs — resolve and grade email-auth DNS for an FSOS sending domain.
//
// Checks SPF (single record + ≤10 lookups), DKIM (per expected selector), DMARC
// (present + enforcement level), and MX. Reads ONLY public DNS — first via
// DNS-over-HTTPS (Cloudflare, Google, Quad9), then falling back to the system
// resolver (node:dns). Takes NO secrets, never reads .env, writes nothing to disk.
// Self-contained (Node 18+ global fetch).
//
// Usage:
//   node validate_dns.mjs <domain> [--selectors=a,b] [--json] [--doh=<url>]
//   node validate_dns.mjs --self-test        # offline: exercise the graders on fixtures
//
// Examples:
//   node validate_dns.mjs notify.markistfsa.com --selectors=resend
//   node validate_dns.mjs markistfsa.com --selectors=google --json
//
// Exit code: 0 = no hard failures · 1 = at least one FAIL · 2 = usage or resolver-unreachable.
//
// NOTE ON A BLOCKED RESOLVER: if no resolver can be reached (locked-down egress),
// the script reports "resolver unreachable" and exits 2 — it does NOT report the
// records as absent/failed, because "couldn't ask" is not the same as "not published".

import dnsPromises from 'node:dns/promises';

const DOH_ENDPOINTS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
  'https://dns.quad9.net/dns-query',
];
const TYPE_NUM = { A: 1, TXT: 16, CNAME: 5, MX: 15 };

class ResolverUnreachable extends Error {}

// ─────────────────────────────── args ───────────────────────────────
function parseArgs(argv) {
  const args = { domain: null, selectors: [], json: false, doh: null, selfTest: false, help: false };
  for (const a of argv.slice(2)) {
    if (a === '--json') args.json = true;
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--selectors=')) args.selectors = a.slice(12).split(',').map(s => s.trim()).filter(Boolean);
    else if (a.startsWith('--doh=')) args.doh = a.slice(6);
    else if (!a.startsWith('--') && !args.domain) args.domain = a.trim().replace(/\.$/, '');
  }
  return args;
}

// ─────────────────────── resolver (DoH → system) ───────────────────────
let dohBlocked = false;

async function queryDoH(name, type, dohOverride) {
  const endpoints = dohOverride ? [dohOverride] : DOH_ENDPOINTS;
  let blocked = 0;
  for (const ep of endpoints) {
    try {
      const url = `${ep}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
      const res = await fetch(url, { headers: { accept: 'application/dns-json' } });
      if (res.status === 403 || res.status === 407) { blocked++; continue; } // egress proxy block
      if (!res.ok) continue;
      const data = await res.json();
      return (data.Answer || []).filter(a => a.type === TYPE_NUM[type]).map(a => cleanTxt(a.data));
    } catch { /* try next endpoint */ }
  }
  if (blocked === endpoints.length) throw new ResolverUnreachable('DoH endpoints blocked by egress policy');
  return null; // reachable but no answer of that type
}

async function querySystem(name, type) {
  try {
    if (type === 'TXT') return (await dnsPromises.resolveTxt(name)).map(chunks => chunks.join(''));
    if (type === 'CNAME') return await dnsPromises.resolveCname(name);
    if (type === 'MX') return (await dnsPromises.resolveMx(name)).map(r => `${r.priority} ${r.exchange}`);
    if (type === 'A') return await dnsPromises.resolve4(name);
  } catch (e) {
    if (['ENOTFOUND', 'ENODATA'].includes(e.code)) return []; // definitively absent
    throw new ResolverUnreachable(`system resolver: ${e.code || e.message}`);
  }
  return [];
}

// Unified query: DoH first, then system resolver. Throws ResolverUnreachable if neither works.
async function query(name, type, dohOverride) {
  if (!dohBlocked) {
    try {
      const r = await queryDoH(name, type, dohOverride);
      if (r !== null) return r;
    } catch (e) {
      if (e instanceof ResolverUnreachable) dohBlocked = true; else throw e;
    }
  }
  return querySystem(name, type);
}

function cleanTxt(d) {
  if (/^".*"$/.test(d) || d.includes('" "')) return d.replace(/"\s+"/g, '').replace(/^"|"$/g, '');
  return d.replace(/\.$/, '');
}

// ─────────────────────── pure graders (testable) ───────────────────────
// Each returns { status, detail }. Kept free of I/O so --self-test can drive them.

function gradeSpf(txts, lookupCount) {
  const spfs = txts.filter(t => /^v=spf1/i.test(t));
  if (spfs.length === 0) return { status: 'FAIL', detail: 'no v=spf1 record published' };
  if (spfs.length > 1) return { status: 'FAIL', detail: `${spfs.length} SPF records (must be exactly 1 — multiple = permerror)` };
  const spf = spfs[0];
  const all = (/[-~?+]all\b/.exec(spf) || [])[0];
  const allNote = all ? `policy ${all}` : 'no "all" mechanism (weak)';
  if (lookupCount > 10) return { status: 'FAIL', detail: `${lookupCount} DNS lookups (>10 = permerror). ${allNote}` };
  const unsafe = all === '+all' ? ' — +all is unsafe' : '';
  return { status: 'PASS', detail: `1 record, ${lookupCount}/10 lookups, ${allNote}${unsafe}` };
}

function gradeDmarc(txts) {
  const dmarc = txts.find(t => /^v=DMARC1/i.test(t));
  if (!dmarc) return { status: 'FAIL', detail: 'no DMARC record published' };
  const p = (/\bp=(none|quarantine|reject)\b/i.exec(dmarc) || [])[1];
  const rua = /\brua=/i.test(dmarc);
  if (!p) return { status: 'FAIL', detail: `record present but no p= policy: ${dmarc}` };
  if (p.toLowerCase() === 'none') {
    return { status: 'WARN', detail: `p=none — published but NOT enforcing (spoofers not blocked). Ramp to quarantine→reject once RUA reports are clean.${rua ? '' : ' Also: no rua= reporting address.'}` };
  }
  return { status: 'PASS', detail: `p=${p} (enforcing)${rua ? ' with rua reporting' : ' — but no rua= address; add one'}` };
}

function gradeDkim(sel, cnames, txts) {
  const dkimTxt = txts.find(t => /(v=DKIM1|k=rsa|p=)/i.test(t));
  if (cnames.length) return { status: 'PASS', detail: `CNAME → ${cnames[0]} (provider-managed key)` };
  if (dkimTxt) return { status: 'PASS', detail: `TXT key published (${dkimTxt.length} chars)` };
  return { status: 'FAIL', detail: `no DKIM record at ${sel}._domainkey.<domain> — selector missing or wrong` };
}

// Count SPF DNS-lookup mechanisms, following include/redirect (bounded, network-backed).
async function countSpfLookups(spf, doh, seen = new Set(), depth = 0) {
  if (depth > 10) return 99;
  let count = 0;
  for (const term of spf.split(/\s+/)) {
    const m = /^(include|a|mx|ptr|exists|redirect)[:=]?(.*)$/i.exec(term);
    if (!m) continue;
    const mech = m[1].toLowerCase();
    if (['a', 'mx', 'ptr', 'exists'].includes(mech)) { count += 1; continue; }
    count += 1; // include / redirect
    const target = m[2];
    if (target && !seen.has(target)) {
      seen.add(target);
      try {
        const inc = (await query(target, 'TXT', doh)).find(t => /^v=spf1/i.test(t));
        if (inc) count += await countSpfLookups(inc, doh, seen, depth + 1);
      } catch (e) { if (e instanceof ResolverUnreachable) throw e; }
    }
  }
  return count;
}

// ─────────────────────── live checks ───────────────────────
async function runLive(args) {
  const results = [];
  const domain = args.domain;

  const spfTxts = await query(domain, 'TXT', args.doh);
  const spfRecord = spfTxts.find(t => /^v=spf1/i.test(t));
  const lookups = spfRecord ? await countSpfLookups(spfRecord, args.doh) : 0;
  results.push(['SPF', gradeSpf(spfTxts, lookups)]);

  if (!args.selectors.length) {
    results.push(['DKIM', { status: 'WARN', detail: 'no --selectors given; pass the selector(s) Resend/Google issued, e.g. --selectors=resend' }]);
  } else {
    for (const sel of args.selectors) {
      const host = `${sel}._domainkey.${domain}`;
      const cnames = await query(host, 'CNAME', args.doh);
      const txts = cnames.length ? [] : await query(host, 'TXT', args.doh);
      results.push([`DKIM:${sel}`, gradeDkim(sel, cnames, txts)]);
    }
  }
  results.push(['DKIM-ALIGN', { status: 'INFO', detail: `alignment (d= must equal the From subdomain "${domain}") is verified in the message Authentication-Results header, not in DNS — confirm dkim=pass AND d=${domain}` }]);

  const dmarcTxts = await query(`_dmarc.${domain}`, 'TXT', args.doh);
  results.push(['DMARC', gradeDmarc(dmarcTxts)]);

  const mx = await query(domain, 'MX', args.doh);
  results.push(['MX', mx.length
    ? { status: 'PASS', detail: `${mx.length} MX host(s): ${mx.map(m => m.split(' ').pop()).join(', ')}` }
    : { status: 'INFO', detail: 'no MX (fine for a send-only subdomain; required on the root domain to receive bounce/DMARC-report mail)' }]);

  return results;
}

// ─────────────────────── offline self-test ───────────────────────
function selfTest() {
  const cases = [
    { name: 'SPF: two records → FAIL', got: gradeSpf(['v=spf1 include:a -all', 'v=spf1 include:b ~all'], 2), want: 'FAIL' },
    { name: 'SPF: >10 lookups → FAIL', got: gradeSpf(['v=spf1 include:x -all'], 11), want: 'FAIL' },
    { name: 'SPF: clean single record → PASS', got: gradeSpf(['v=spf1 include:_spf.google.com -all'], 3), want: 'PASS' },
    { name: 'SPF: none → FAIL', got: gradeSpf([], 0), want: 'FAIL' },
    { name: 'DMARC: p=none → WARN (not enforcing)', got: gradeDmarc(['v=DMARC1; p=none; rua=mailto:r@x']), want: 'WARN' },
    { name: 'DMARC: p=reject → PASS', got: gradeDmarc(['v=DMARC1; p=reject; rua=mailto:r@x']), want: 'PASS' },
    { name: 'DMARC: missing → FAIL', got: gradeDmarc(['v=spf1 whatever']), want: 'FAIL' },
    { name: 'DKIM: missing selector → FAIL', got: gradeDkim('resend', [], []), want: 'FAIL' },
    { name: 'DKIM: CNAME present → PASS', got: gradeDkim('resend', ['resend._domainkey.resend.com'], []), want: 'PASS' },
  ];
  let fails = 0;
  console.log(`\nvalidate_dns self-test (offline grader fixtures)\n${'─'.repeat(56)}`);
  for (const c of cases) {
    const ok = c.got.status === c.want;
    if (!ok) fails++;
    console.log(`${ok ? '✅' : '❌'} ${c.name}\n     → got ${c.got.status.padEnd(4)} want ${c.want}  | ${c.got.detail}`);
  }
  console.log('─'.repeat(56));
  console.log(fails ? `❌ ${fails} grader case(s) failed` : `✅ all ${cases.length} grader cases passed`);
  process.exit(fails ? 1 : 0);
}

// ─────────────────────── main ───────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log('Usage: node validate_dns.mjs <domain> [--selectors=a,b] [--json] [--doh=<url>] | --self-test'); process.exit(0); }
  if (args.selfTest) return selfTest();
  if (!args.domain) { console.error('Error: <domain> required (or --self-test). See --help.'); process.exit(2); }

  let results;
  try {
    results = await runLive(args);
  } catch (e) {
    if (e instanceof ResolverUnreachable) {
      console.error(`Resolver unreachable: ${e.message}.\nNo DNS egress from here — run this where public DNS (DoH or port 53) is reachable, or pass a permitted --doh=<url>.\nThis is NOT a verdict on the records; nothing was resolved. (Try --self-test to verify the grader logic offline.)`);
      process.exit(2);
    }
    console.error(`Unexpected error: ${e.message}`);
    process.exit(2);
  }

  const hardFail = results.some(([, r]) => r.status === 'FAIL');
  if (args.json) {
    console.log(JSON.stringify({ domain: args.domain, selectors: args.selectors, results: results.map(([check, r]) => ({ check, ...r })), ok: !hardFail }, null, 2));
  } else {
    const icon = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ', INFO: 'ℹ️ ' };
    console.log(`\nDNS auth report — ${args.domain}\n${'─'.repeat(56)}`);
    for (const [check, r] of results) console.log(`${icon[r.status] || '  '} ${check.padEnd(12)} ${r.detail}`);
    console.log('─'.repeat(56));
    console.log(hardFail ? '❌ FAIL — fix the records above before sending.' : '✅ No hard failures. (Review any ⚠️  warnings.)');
  }
  process.exit(hardFail ? 1 : 0);
}

main();
