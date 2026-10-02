// #265 FAILURE-CLASS GUARD — every automation FSOS presents is either wired end-to-end or shown as
// reference copy. Holds src/lib/ops/automation-registry.ts against the real wiring:
//   1. every vercel.json cron resolves to a JOBS key or a static /api/cron/<route> handler;
//   2. every JOBS key is scheduled, or declared an alias of a scheduled job (JOB_ALIASES);
//   3. every vercel.json cron has a registry entry, and every registry cron/cron_route entry is
//      scheduled, dispatches to its declared consumer export, and that export exists;
//   4. every webhook entry's route imports its consumer export;
//   5. every `reference` entry's UI renders REFERENCE_COPY_LABEL — a catalogue nothing executes
//      may not read like a live automation (the #265 defect: "These fire on events" over a list no
//      code ever dispatched).
// Run: node tests/automation-wiring.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { bundle } from './helpers/workshop-harness.mjs'

const reg = await bundle('src/lib/ops/automation-registry.ts')
const { AUTOMATIONS, JOB_ALIASES, REFERENCE_COPY_LABEL } = reg
const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons.map((c) => c.path.replace(/^\/api\/cron\//, ''))
const jobsSrc = readFileSync('src/jobs/index.ts', 'utf8')
const JOB_CALLS = Object.fromEntries([...jobsSrc.matchAll(/'([a-z0-9-]+)': async \(\) => \(await h\(\)\)\.([A-Za-z]+)\(\)/g)].map((m) => [m[1], m[2]]))
const routeDir = (r) => `src/app/api/cron/${r}/route.ts`
const exportsFn = (file, name) => new RegExp(`export (async )?function ${name}\\b`).test(readFileSync(file, 'utf8'))

const failures = []
const check = (name, fn) => { try { fn(); console.log('  ✓', name) } catch (e) { failures.push(name); console.log('  ✗', name + ':', e.message) } }

console.log('Scheduled wiring')
check('every vercel.json cron resolves to a JOBS key or a static cron route', () => {
  for (const c of crons) assert.ok(JOB_CALLS[c] || existsSync(routeDir(c)), `/api/cron/${c} resolves to nothing`)
})
check('every JOBS key is scheduled or a declared alias of a scheduled job', () => {
  for (const k of Object.keys(JOB_CALLS)) {
    if (JOB_ALIASES[k]) { assert.ok(crons.includes(JOB_ALIASES[k]), `${k} aliases unscheduled ${JOB_ALIASES[k]}`); continue }
    assert.ok(crons.includes(k), `JOBS['${k}'] is never scheduled (orphan job)`)
  }
})
const schedOf = Object.fromEntries(JSON.parse(readFileSync('vercel.json', 'utf8')).crons.map((c) => [c.path.replace(/^\/api\/cron\//, ''), c.schedule]))
const cadenceOf = (sched) => {
  const [min, hour] = sched.split(' ')
  if (min.includes('*') || min.includes('/')) return 'sub_hourly'
  return hour === '*' ? 'hourly' : 'daily'
}
check('every scheduled registry entry declares the cadence vercel.json actually runs it at', () => {
  for (const a of AUTOMATIONS) {
    const k = a.trigger.job ?? a.trigger.route
    if (!k || !schedOf[k]) continue
    assert.equal(a.cadence ?? 'daily', cadenceOf(schedOf[k]), `${a.key}: registry cadence disagrees with "${schedOf[k]}"`)
  }
})
check('every vercel.json cron has a registry entry', () => {
  const keys = new Set(AUTOMATIONS.filter((a) => a.trigger.kind === 'cron' || a.trigger.kind === 'cron_route').map((a) => a.trigger.job ?? a.trigger.route))
  for (const c of crons) assert.ok(keys.has(c), `cron ${c} is missing from the automation registry`)
})
for (const a of AUTOMATIONS) {
  if (a.trigger.kind === 'cron') {
    check(`${a.key}: scheduled, JOBS → ${a.consumer.export}, exported by ${a.consumer.file}`, () => {
      assert.ok(crons.includes(a.trigger.job), 'not scheduled in vercel.json')
      assert.equal(JOB_CALLS[a.trigger.job], a.consumer.export, 'JOBS dispatches to a different handler')
      assert.ok(exportsFn(a.consumer.file, a.consumer.export), 'consumer export missing')
    })
  } else if (a.trigger.kind === 'cron_route') {
    check(`${a.key}: scheduled route imports and calls ${a.consumer.export}`, () => {
      assert.ok(crons.includes(a.trigger.route), 'not scheduled in vercel.json')
      const src = readFileSync(routeDir(a.trigger.route), 'utf8')
      assert.match(src, new RegExp(`\\b${a.consumer.export}\\(`), 'route never calls its consumer')
      assert.ok(exportsFn(a.consumer.file, a.consumer.export), 'consumer export missing')
    })
  } else if (a.trigger.kind === 'webhook') {
    check(`${a.key}: webhook route reaches ${a.consumer.export}`, () => {
      assert.ok(existsSync(a.trigger.route), 'route file missing')
      assert.ok(exportsFn(a.consumer.file, a.consumer.export), 'consumer export missing')
      const src = readFileSync(a.trigger.route, 'utf8')
      const direct = new RegExp(`\\b${a.consumer.export}\\(`).test(src)
      assert.ok(direct, 'route never calls its consumer')
    })
  }
}

console.log('\nReference-only catalogues read as reference (#265)')
for (const a of AUTOMATIONS.filter((x) => x.reference)) {
  check(`${a.key}: ${a.reference.uiFile} renders "${REFERENCE_COPY_LABEL}"`, () => {
    assert.equal(a.trigger.kind, 'none')
    assert.equal(a.consumer, null)
    const src = readFileSync(a.reference.uiFile, 'utf8')
    assert.ok(src.includes('REFERENCE_COPY_LABEL') || src.includes(REFERENCE_COPY_LABEL), 'presents a display-only catalogue as if it runs')
  })
}

if (failures.length) { console.error(`\n✗ ${failures.length} wiring check(s) failed.`); process.exit(1) }
console.log('\nAutomation wiring guard passed.')
process.exit(0)
