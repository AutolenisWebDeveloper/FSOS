// Campaign surface parity — the structural and state rules that Phase 3 tightened.
//
// These are the checks a person would make by LOOKING at the three campaigns side by side
// at three widths in two themes. No browser exists in this environment, so they are
// asserted against the source instead. That is a weaker guarantee than seeing it, and it
// is recorded as such in the pass report — but it is strong enough to stop the specific
// regressions this pass fixed from creeping back.
//
// Run: node tests/comms-campaign-surface.test.mjs

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const ENGINES = [
  { key: 'life_conversion', dir: 'life-conversion', title: 'Life Conversion' },
  { key: 'cross_sell_life', dir: 'cross-sell-life', title: 'Cross-Sell Life' },
  { key: 'pipeline_winback', dir: 'pipeline-winback', title: 'Pipeline Win-Back' },
]
const base = 'src/app/(fsa)/app/comms'
const listPage = (e) => `${base}/${e.dir}/page.tsx`
const detailPage = (e) => `${base}/${e.dir}/[id]/page.tsx`
const listLoading = (e) => `${base}/${e.dir}/loading.tsx`
const detailLoading = (e) => `${base}/${e.dir}/[id]/loading.tsx`
const SHARED = 'src/components/comms/campaign'
const read = (p) => readFileSync(p, 'utf8')

console.log('campaign surfaces — route + state parity')

t('every engine has both a list and a detail route', () => {
  // Win-Back had neither: one route served the detail from the list URL.
  for (const e of ENGINES) {
    assert.ok(existsSync(listPage(e)), `${e.key}: missing list page`)
    assert.ok(existsSync(detailPage(e)), `${e.key}: missing detail page`)
  }
})

t('every route ships a loading skeleton', () => {
  for (const e of ENGINES) {
    assert.ok(existsSync(listLoading(e)), `${e.key}: list route has no loading skeleton`)
    assert.ok(existsSync(detailLoading(e)), `${e.key}: detail route has no loading skeleton`)
  }
})

t('REGRESSION: a skeleton title cannot drift from the page it stands in for', () => {
  // The skeletons said "Life Conversion Campaign" while the loaded pages said
  // "Life Conversion", so the heading visibly changed as the load completed. Deriving
  // both from the registry makes that impossible rather than merely fixed once.
  for (const e of ENGINES) {
    for (const f of [listLoading(e), detailLoading(e)]) {
      const src = read(f)
      assert.match(src, /CAMPAIGN_ENGINES/, `${f} hardcodes its title instead of reading the registry`)
      assert.match(src, /title=\{ENGINE\.title\}/, `${f} does not use the registry title`)
      assert.ok(!/title="[^"]+"/.test(src), `${f} still has a hardcoded title string`)
    }
  }
})

t('a list route renders a list skeleton and a detail route a detail skeleton', () => {
  // Win-Back rendered the campaign DETAIL skeleton on what was nominally its list route.
  for (const e of ENGINES) {
    assert.match(read(listLoading(e)), /ListSkeleton/, `${e.key}: list route shows the wrong skeleton`)
    assert.match(read(detailLoading(e)), /CampaignDetailSkeleton/, `${e.key}: detail route shows the wrong skeleton`)
  }
})

console.log('\ncampaign surfaces — canonical section order')

/** The numbered `{/* N — Title *​/}` markers each detail page carries, in file order. */
function sections(file) {
  return [...read(file).matchAll(/\{\/\*\s*(\d+)\s*—\s*([^*]+?)\s*\*\//g)].map((m) => ({
    n: Number(m[1]),
    title: m[2].trim(),
  }))
}

t('every detail page carries the numbered section markers', () => {
  for (const e of ENGINES) {
    assert.ok(sections(detailPage(e)).length >= 6, `${e.key}: detail page has too few section markers to verify order`)
  }
})

t('REGRESSION: sections appear in one canonical order on all three engines', () => {
  // No two pages ordered their sections the same way before this pass, so moving
  // between campaigns meant relearning the page each time.
  for (const e of ENGINES) {
    const nums = sections(detailPage(e)).map((s) => s.n)
    const sorted = [...nums].sort((a, b) => a - b)
    assert.deepEqual(nums, sorted, `${e.key}: sections are out of canonical order — ${nums.join(', ')}`)
    assert.equal(new Set(nums).size, nums.length, `${e.key}: duplicate section number`)
  }
})

t('a shared section number means the same section on every engine', () => {
  const byNumber = new Map()
  for (const e of ENGINES) {
    for (const s of sections(detailPage(e))) {
      const seen = byNumber.get(s.n)
      if (seen) {
        assert.equal(s.title, seen.title, `section ${s.n} is "${s.title}" on ${e.key} but "${seen.title}" on ${seen.engine}`)
      } else {
        byNumber.set(s.n, { title: s.title, engine: e.key })
      }
    }
  }
  // The state line leads every campaign screen.
  assert.match(byNumber.get(0).title, /OK right now/)
})

t('the state line is on every campaign surface, list and detail', () => {
  for (const e of ENGINES) {
    for (const f of [listPage(e), detailPage(e)]) {
      assert.match(read(f), /<CampaignStateLine/, `${f} does not lead with the campaign state line`)
    }
  }
})

t('cross-links are on all three engines, so none is a dead end', () => {
  for (const e of ENGINES) {
    assert.match(read(detailPage(e)), /CampaignCrossLinks/, `${e.key} detail has no path to its sibling campaigns`)
  }
})

console.log('\ncampaign surfaces — interaction + state polish')

t('every disclosure control is keyboard-focusable with a visible ring', () => {
  // A bare <summary> is focusable but paints no ring in several browsers, so a
  // keyboard user loses their place inside a 35-row asset list.
  const files = [...ENGINES.map(detailPage), ...ENGINES.map(listPage), `${SHARED}/CampaignAssetsTable.tsx`]
  for (const f of files) {
    if (!existsSync(f)) continue
    for (const line of read(f).split('\n')) {
      if (line.includes('<summary')) {
        assert.match(line, /focus-visible:ring/, `${f}: a <summary> has no visible focus ring —\n    ${line.trim()}`)
      }
    }
  }
})

t('every empty state in the shared components invites an action (§17)', () => {
  // "No enrollments yet" with no next step is a dead end, which §17 forbids.
  for (const f of ['CampaignEnrollmentTable', 'CampaignAssetsTable', 'CampaignAnalyticsPanel']) {
    const src = read(`${SHARED}/${f}.tsx`)
    const count = (src.match(/<EmptyState/g) ?? []).length
    if (count === 0) continue
    assert.equal((src.match(/action=\{/g) ?? []).length, count, `${f}: an EmptyState has no action`)
  }
})

t('no campaign surface double-wraps a Table (§9)', () => {
  const files = [...ENGINES.map(detailPage), ...ENGINES.map(listPage), `${SHARED}/CampaignEnrollmentTable.tsx`, `${SHARED}/CampaignScheduleTable.tsx`]
  for (const f of files) {
    if (!existsSync(f)) continue
    assert.ok(
      !/overflow-x-auto rounded-lg border/.test(read(f)),
      `${f} wraps Table again — it already renders its own bordered container`,
    )
  }
})

t('every shared table carries an sr-only caption (§9)', () => {
  for (const f of ['CampaignEnrollmentTable', 'CampaignScheduleTable']) {
    assert.match(read(`${SHARED}/${f}.tsx`), /<TableCaption srOnly>/, `${f} has no accessible caption`)
  }
})

t('the shared components stay Server-Component-safe', () => {
  // These render inside Server Components. A stray 'use client' would pull the whole
  // campaign surface into the client bundle (§14 performance budget).
  for (const f of ['CampaignKit', 'CampaignStateLine', 'CampaignEnrollmentTable', 'CampaignScheduleTable', 'CampaignAssetsTable', 'CampaignAnalyticsPanel', 'CampaignControlsSection']) {
    const src = read(`${SHARED}/${f}.tsx`)
    assert.ok(!/^'use client'/m.test(src), `${f} became a client component`)
    assert.ok(!/\buseState\b|\buseEffect\b/.test(src), `${f} uses a hook and cannot be a Server Component`)
  }
})

/**
 * Strip comments before scanning for colors. Several of these files document the raw
 * palette values they REMOVED (`border-amber-400/60`), and matching prose would make this
 * assertion fire on its own changelog.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

t('no campaign surface hardcodes a color outside the token system', () => {
  const files = [...ENGINES.map(detailPage), ...ENGINES.map(listPage), ...['CampaignKit', 'CampaignStateLine', 'CampaignEnrollmentTable', 'CampaignScheduleTable', 'CampaignAssetsTable', 'CampaignAnalyticsPanel', 'CampaignControlsSection'].map((f) => `${SHARED}/${f}.tsx`)]
  for (const f of files) {
    if (!existsSync(f)) continue
    const src = code(read(f))
    const palette = src.match(/\b(?:border|bg|text|ring)-(?:amber|red|green|blue|yellow|orange|slate|zinc|gray|sky|teal)-\d{2,3}\b/)
    assert.equal(palette, null, `${f} uses the raw palette color ${palette?.[0]} instead of a token`)
    const hex = src.match(/#[0-9a-fA-F]{6}\b/)
    assert.equal(hex, null, `${f} inlines the hex ${hex?.[0]}`)
  }
})

console.log(`\n${passed} checks passed.`)
