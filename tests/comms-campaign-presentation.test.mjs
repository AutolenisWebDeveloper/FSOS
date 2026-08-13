// Shared campaign presentation vocabulary (src/lib/comms/campaign-presentation.ts) and the
// kit built on it (src/components/comms/campaign/CampaignKit.tsx).
//
// ─── Why this file type-checks instead of grepping ────────────────────────────
//
// The obvious way to assert "the per-page STATUS_TONE / KIND_LABEL / KIND_TONE forks are
// gone" is to read each page and assert the declaration is absent. That test is
// FALSE-GREEN, and it has already shipped a broken build once:
//
//   deleting `const KIND_TONE = …` while leaving `KIND_TONE[t.kind]` at the call site
//   makes the grep assertion PASS (the declaration really is absent) while the page no
//   longer compiles — TS2304: Cannot find name 'KIND_TONE'.
//
// The grep gets greener as the tree gets more broken. So every fork-removal assertion
// below is paired with a real `tsc` pass over the consuming pages, and `regression:
// a deleted declaration with a live call site is caught` proves the guard actually
// fires on exactly that mutation rather than merely being present.
//
// Run: node tests/comms-campaign-presentation.test.mjs

import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// ─── The pages that consume the shared layer ──────────────────────────────────
// Adding a campaign surface without adding it here means it is not compile-guarded.
const CONSUMERS = [
  'src/app/(fsa)/app/comms/life-conversion/page.tsx',
  'src/app/(fsa)/app/comms/life-conversion/[id]/page.tsx',
  'src/app/(fsa)/app/comms/cross-sell-life/page.tsx',
  'src/app/(fsa)/app/comms/cross-sell-life/[id]/page.tsx',
  'src/app/(fsa)/app/comms/pipeline-winback/page.tsx',
  'src/app/(fsa)/app/comms/pipeline-winback/[id]/page.tsx',
  'src/app/(fsa)/app/comms/district-nurture/page.tsx',
  'src/app/(fsa)/app/comms/district-nurture/[id]/page.tsx',
]

// ─── 1. The pure vocabulary ───────────────────────────────────────────────────

const out = mkdtempSync(join(tmpdir(), 'fsos-campaign-'))
// `--rootDir src/lib` is load-bearing: without it tsc derives the output layout from the
// COMMON SOURCE DIRECTORY of whatever files the compilation happens to pull in. Today
// message-status.ts reaches src/lib/compliance through gate.ts, so the common root is
// src/lib and the emit lands at <out>/comms/…. Drop that transitive import and the root
// collapses to src/lib/comms, the emit moves to <out>/…, and the require below fails with
// a confusing MODULE_NOT_FOUND that has nothing to do with what broke. Pinning rootDir
// makes the layout a property of this test rather than of an unrelated import graph.
execSync(
  `npx tsc src/lib/comms/campaign-presentation.ts src/lib/comms/message-status.ts ` +
    `src/lib/comms/template-catalog.ts ` +
    `--rootDir src/lib --outDir ${out} --module commonjs --target es2020 --moduleResolution node ` +
    `--skipLibCheck --esModuleInterop --lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const P = require(join(out, 'comms/campaign-presentation.js'))
// CAMPAIGN_LABELS is defined in template-catalog.ts (pure, DB-free) and re-exported by
// assets.ts, so both the console asset picker and the template library label a campaign
// identically. Loading the real map lets the deep-link check below assert the exported
// keys rather than grep source text.
const CATALOG = require(join(out, 'comms/template-catalog.js'))

console.log('\ncampaign-presentation — status vocabulary')

t('campaign status maps onto the FSOS status tokens, not generic badge fills', () => {
  // The whole point of the module: `active` must read as the semantic status token so a
  // live campaign looks like every other live thing in FSOS, not like a `default` chip.
  assert.equal(P.campaignStatus('active').variant, 'active')
  assert.equal(P.campaignStatus('running').variant, 'active')
  assert.equal(P.campaignStatus('draft').variant, 'draft')
  assert.equal(P.campaignStatus('paused').variant, 'pending')
  assert.equal(P.campaignStatus('emergency_stopped').variant, 'escalated')
  assert.equal(P.campaignStatus('archived').variant, 'outline')
})

t('the two engines that spell "live" differently both resolve to live', () => {
  // life/win-back use `active`; cross-sell uses `running`. A shared surface cannot
  // hardcode either one.
  assert.equal(P.isCampaignLive('active'), true)
  assert.equal(P.isCampaignLive('running'), true)
  assert.equal(P.isCampaignLive('paused'), false)
  assert.equal(P.isCampaignLive(null), false)
})

t('no label leaks a raw enum underscore', () => {
  const labels = [
    ...['draft', 'approval_pending', 'active', 'running', 'paused', 'disabled', 'emergency_stopped', 'archived'].map(
      (s) => P.campaignStatus(s).label,
    ),
    ...['active', 'paused_for_conversation', 'waiting_for_advisor', 'appointment_scheduled', 'policy_issued', 'purchased_elsewhere', 'opted_out'].map(
      (s) => P.enrollmentStatus(s).label,
    ),
    ...['email', 'sms', 'ai_conversation', 'advisor_outreach'].map((k) => P.touchKind(k).label),
    ...['approved', 'submitted', 'draft', 'rejected'].map((a) => P.approvalStatus(a).label),
  ]
  for (const label of labels) {
    assert.ok(!label.includes('_'), `"${label}" leaks an enum underscore into the UI`)
  }
})

t('an unrecognized enum degrades to words, never to an underscore', () => {
  assert.equal(P.campaignStatus('some_new_state').label, 'some new state')
  assert.equal(P.enrollmentStatus('some_new_state').label, 'some new state')
  assert.equal(P.touchKind('carrier_pigeon').label, 'carrier pigeon')
  assert.equal(P.winbackCategory('brand_new_reason'), 'brand new reason')
})

t('every state carries a description — the chip is never unexplained', () => {
  for (const s of ['active', 'paused', 'emergency_stopped', 'archived', 'draft']) {
    assert.ok(P.campaignStatus(s).description.length > 10, `${s} has no usable description`)
  }
})

console.log('\ncampaign-presentation — enrollment + approval')

t('suppression and opt-out read as blocked, not as a neutral outline chip', () => {
  // These two mean "the compliance layer stopped this". Rendering them as a quiet
  // outline chip is how a suppressed enrollment goes unnoticed on a roster.
  assert.equal(P.enrollmentStatus('suppressed').variant, 'blocked')
  assert.equal(P.enrollmentStatus('opted_out').variant, 'blocked')
})

t('an open customer conversation reads as a pause, not as active', () => {
  // ADR-018: a customer reply pauses promotional automation. The roster must show that.
  assert.equal(P.enrollmentStatus('paused_for_conversation').variant, 'pending')
  assert.equal(P.enrollmentStatus('conversation_active').variant, 'pending')
})

t('REGRESSION: a missing template reads as blocked, not as an em dash', () => {
  // Win-Back rendered `missing` as a plain outline chip and the other two rendered
  // nothing at all, so a dispatchable touch with no template looked fine on two of
  // three screens.
  const missing = P.approvalStatus(null)
  assert.equal(missing.variant, 'blocked')
  assert.equal(missing.label, 'Missing')
})

t('only an approved template reads as dispatchable', () => {
  assert.equal(P.approvalStatus('approved').variant, 'won')
  for (const s of ['submitted', 'draft', 'rejected']) {
    assert.notEqual(P.approvalStatus(s).variant, 'won', `${s} must not read as approved`)
  }
})

console.log('\ncampaign-presentation — engine registry')

t('the registry covers exactly the four native engines', () => {
  assert.deepEqual(Object.keys(P.CAMPAIGN_ENGINES).sort(), ['cross_sell_life', 'district_nurture', 'life_conversion', 'pipeline_winback'])
  assert.equal(P.CAMPAIGN_ENGINE_LIST.length, 4)
})

t('every engine key matches its own record key', () => {
  for (const [key, engine] of Object.entries(P.CAMPAIGN_ENGINES)) {
    assert.equal(engine.key, key, `${key} disagrees with its record`)
  }
})

t('every engine route and API root resolves to a real file', () => {
  for (const engine of P.CAMPAIGN_ENGINE_LIST) {
    const page = join('src/app/(fsa)', engine.href, 'page.tsx')
    assert.ok(existsSync(page), `${engine.key}: ${page} does not exist`)
    const api = join('src/app', engine.apiRoot, 'route.ts')
    assert.ok(existsSync(api), `${engine.key}: ${api} does not exist`)
  }
})

t('registry touch counts and day spans match each engine schedule.ts', () => {
  // The registry's `20 touches · 180d` is rendered to the user in cross-links and empty
  // states. Pinning it to the authoritative timeline means the copy cannot drift away
  // from the campaign it describes.
  const SCHEDULES = {
    life_conversion: 'src/lib/life-campaign/schedule.ts',
    cross_sell_life: 'src/lib/cross-sell-life/schedule.ts',
    pipeline_winback: 'src/lib/pipeline-winback/schedule.ts',
    district_nurture: 'src/lib/district-nurture/schedule.ts',
  }
  for (const engine of P.CAMPAIGN_ENGINE_LIST) {
    const src = readFileSync(SCHEDULES[engine.key], 'utf8')
    const touchNos = [...src.matchAll(/touch_no:\s*(\d+)/g)].map((m) => Number(m[1]))
    const dayOffsets = [...src.matchAll(/day_offset:\s*(\d+)/g)].map((m) => Number(m[1]))
    assert.equal(touchNos.length, engine.touches, `${engine.key}: registry says ${engine.touches} touches, schedule.ts has ${touchNos.length}`)
    assert.equal(Math.max(...dayOffsets), engine.days, `${engine.key}: registry says ${engine.days} days, schedule.ts ends at day ${Math.max(...dayOffsets)}`)
  }
})

t('cross-sell is the only versioned engine', () => {
  assert.equal(P.CAMPAIGN_ENGINES.cross_sell_life.versioned, true)
  assert.equal(P.CAMPAIGN_ENGINES.life_conversion.versioned, false)
  assert.equal(P.CAMPAIGN_ENGINES.pipeline_winback.versioned, false)
})

t('every engine seed migration exists', () => {
  const { readdirSync } = require('node:fs')
  const migrations = readdirSync('supabase/migrations')
  for (const engine of P.CAMPAIGN_ENGINE_LIST) {
    assert.ok(
      migrations.some((f) => f.startsWith(engine.seedMigration + '_')),
      `${engine.key}: the empty state points at migration ${engine.seedMigration}, which does not exist`,
    )
  }
})

t('breadcrumbs and deep links are built, not hand-typed', () => {
  const e = P.CAMPAIGN_ENGINES.life_conversion
  assert.deepEqual(P.campaignBreadcrumb(e), [
    { label: 'FSA', href: '/app' },
    { label: 'Comms', href: '/app/comms' },
    { label: 'Life Conversion' },
  ])
  const leaf = P.campaignBreadcrumb(e, 'Term Conversion 2026')
  assert.equal(leaf.length, 4)
  assert.equal(leaf[2].href, e.href, 'the engine crumb must stay clickable on a detail page')
  assert.equal(leaf[3].href, undefined, 'the leaf crumb is the current page and must not link')
  assert.equal(P.campaignTestHref(e), '/app/comms/console?mode=test&campaign=life_conversion')
  assert.equal(P.campaignDetailHref(e, 'abc'), '/app/comms/life-conversion/abc')
})

t('the console deep-link key matches the asset catalog key', () => {
  // campaignTestHref sends `?campaign=<key>` to the console, which filters the asset
  // catalog by campaign_key. A key the catalog does not know renders an empty picker.
  // The same keys drive the /app/comms/templates campaign filter, so an unlabelled key
  // would also show up there as a raw enum.
  for (const engine of P.CAMPAIGN_ENGINE_LIST) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(CATALOG.CAMPAIGN_LABELS, engine.key),
      `${engine.key} is not a CAMPAIGN_LABELS key`,
    )
    assert.notEqual(CATALOG.campaignLabel(engine.key), engine.key, `${engine.key} renders as a raw enum, not a label`)
  }
  // assets.ts must keep re-exporting the single map — a second copy would let the console
  // and the template library drift apart.
  const assets = readFileSync('src/lib/comms/assets.ts', 'utf8')
  assert.match(assets, /export \{ CAMPAIGN_LABELS, campaignLabel \} from '\.\/template-catalog'/)
})

// ─── 2. The fork is gone AND the pages still compile ──────────────────────────

console.log('\ncampaign pages — de-forked and type-checked')

const FORKS = ['STATUS_TONE', 'KIND_TONE', 'KIND_LABEL', 'APPROVAL_TONE', 'CATEGORY_LABEL']

t('no campaign page redeclares a shared presentation map', () => {
  for (const file of CONSUMERS) {
    const src = readFileSync(file, 'utf8')
    for (const fork of FORKS) {
      assert.ok(
        !new RegExp(`const\\s+${fork}\\b`).test(src),
        `${file} redeclares ${fork} — use @/lib/comms/campaign-presentation instead`,
      )
    }
  }
})

t('no campaign page formats a timestamp against the server clock', () => {
  // toLocaleString/toLocaleDateString in a Server Component resolves against the
  // server's timezone (UTC on Vercel), not the advisor's. TimeCell exists for this.
  for (const file of CONSUMERS) {
    const src = readFileSync(file, 'utf8')
    assert.ok(!/toLocale(Date|Time)?String\(/.test(src), `${file} formats a date server-side — use <TimeCell />`)
  }
})

t('no campaign page hardcodes a raw Tailwind palette color', () => {
  // `border-amber-400/60` shipped in two stat cells. Attention is a token (`gold`),
  // not a palette swatch.
  for (const file of CONSUMERS) {
    const src = readFileSync(file, 'utf8')
    const hit = src.match(/\b(?:border|bg|text|ring)-(?:amber|red|green|blue|yellow|orange|slate|zinc|gray)-\d{2,3}\b/)
    assert.equal(hit, null, `${file} hardcodes ${hit?.[0]} — resolve through a design token`)
  }
})

// The compile pass. This is what makes the three assertions above meaningful: without
// it, deleting a declaration and leaving its call sites makes them all pass.
function typecheck(extraFiles = []) {
  const cfg = join(out, `tsconfig.check.${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(
    cfg,
    JSON.stringify({
      extends: join(process.cwd(), 'tsconfig.json'),
      compilerOptions: {
        // The project config is `incremental`, which cannot be combined with a
        // relocated tsBuildInfo cheaply; a clean non-incremental pass is fine here.
        incremental: false,
        noEmit: true,
        baseUrl: process.cwd(),
        paths: { '@/*': ['./src/*'] },
      },
      include: [
        join(process.cwd(), 'next-env.d.ts'),
        ...CONSUMERS.map((f) => join(process.cwd(), f)),
        ...extraFiles.map((f) => join(process.cwd(), f)),
      ],
    }),
  )
  try {
    execFileSync('npx', ['tsc', '-p', cfg], { stdio: 'pipe', encoding: 'utf8' })
    return { ok: true, output: '' }
  } catch (err) {
    return { ok: false, output: String(err.stdout ?? '') + String(err.stderr ?? '') }
  }
}

t('every consuming campaign page type-checks', () => {
  const result = typecheck()
  assert.ok(result.ok, `campaign pages do not compile:\n${result.output}`)
})

t('REGRESSION: a deleted declaration with a live call site is caught', () => {
  // Reproduce the exact defect that shipped: the shared import is removed but the call
  // site stays. A grep-only test PASSES on this mutant (the declaration really is
  // absent). The compile pass must FAIL on it — that difference is the whole point.
  const victim = 'src/app/(fsa)/app/comms/cross-sell-life/[id]/page.tsx'
  const mutantPath = 'src/app/(fsa)/app/comms/cross-sell-life/[id]/__fork-regression.mutant.tsx'
  const src = readFileSync(victim, 'utf8')

  // Strip the shared-kit import, leaving every <CampaignStatusBadge …> call site in place.
  // Matched format-independently (single- or multi-line) so a reformatted import does not
  // silently turn this into a no-op test.
  const KIT_IMPORT = /^import\s*\{[\s\S]*?\}\s*from\s*'@\/components\/comms\/campaign\/CampaignKit'\n/m
  assert.match(src, KIT_IMPORT, `${victim} no longer imports the kit — pick a different victim`)
  const mutant = src.replace(KIT_IMPORT, '')
  assert.notEqual(mutant, src, 'the mutation did not apply — this test is no longer testing anything')
  assert.match(mutant, /<Campaign(StatusBadge|CrossLinks)/, 'the mutant has no live call site left, so there is nothing for tsc to catch')

  // The grep-style assertion the old test used still passes on the mutant…
  for (const fork of FORKS) {
    assert.ok(!new RegExp(`const\\s+${fork}\\b`).test(mutant), 'precondition: the mutant has no forked map')
  }

  writeFileSync(mutantPath, mutant)
  try {
    // …but the compile pass catches it.
    const result = typecheck([mutantPath])
    assert.equal(result.ok, false, 'the type-check passed on a page with an undefined identifier — the guard is not working')
    assert.match(result.output, /TS2304|Cannot find name/, `expected an undefined-identifier error, got:\n${result.output}`)
  } finally {
    rmSync(mutantPath, { force: true })
  }
})

rmSync(out, { recursive: true, force: true })
console.log(`\n${passed} checks passed.`)
