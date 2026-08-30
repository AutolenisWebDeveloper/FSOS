// MIGRATION 134 — one live opportunity per referral, proven by OVERLAPPING TRANSACTIONS
// against real Postgres, not by reasoning about the code.
//
// Batch 4 left two independent check-then-insert writers on opportunities.referral_id
// (the referrals convert route and the workshop attendance placement) with nothing
// serializing them. The realistic trigger is the */15 workshop cron placing an
// opportunity at the moment the FSA converts that same referral: both read "none yet",
// both insert, the pipeline double-counts. This file drives that exact interleaving.
//
// Same method as tests/workshop-registration-claim.test.mjs (WS-004): two real psql
// sessions, one holding an open transaction while the other tries.
// Run: node tests/opportunity-referral-race.test.mjs   (rls suite — needs root Postgres)
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { guardInfraOrExit, bootCluster, stopCluster, freshWorkshopDb, q, sh } from './helpers/workshop-guarantee-common.mjs'

const PGBIN = guardInfraOrExit()
let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

bootCluster(PGBIN)
try {
  const F = freshWorkshopDb({
    startsAtIso: '2026-09-01T18:00:00Z', endsAtIso: '2026-09-01T19:00:00Z',
    timezone: 'America/Chicago', registeredIso: '2026-08-01T00:00:00Z',
  })
  const DB = F.name
  const SQLDIR = '/tmp/fsos-workshop-guarantee-sql'
  const REF = 'aaaa0001-0000-4000-8000-000000000001'
  q(DB, `insert into referrals (id, status) values ('${REF}', 'received') on conflict do nothing`)

  console.log('The index exists and is PARTIAL on both counts')
  {
    const def = q(DB, `select pg_get_indexdef(oid) from pg_class c join pg_index i on i.indexrelid=c.oid where c.relname='idx_opportunities_live_referral'`)
    ok('idx_opportunities_live_referral is a UNIQUE index on referral_id', /create unique index/i.test(def) && /\(referral_id\)/.test(def), def)
    ok('…partial: only LIVE rows, and only rows that HAVE a referral',
      /deleted_at IS NULL/i.test(def) && /referral_id IS NOT NULL/i.test(def), def)
  }

  console.log('\nThe RACE: two overlapping inserts for the same referral')
  {
    q(DB, `delete from opportunities where referral_id='${REF}'`)
    // T1 = the workshop attendance placement, inside an open transaction that holds the
    // index entry. T2 = the operator converting the same referral, arriving mid-flight.
    writeFileSync(`${SQLDIR}/opp-t1.sql`,
      `begin;\ninsert into opportunities (referral_id, engagement, stage, source) values ('${REF}','direct','prospect','workshop_attendance');\nselect pg_sleep(1.5);\ncommit;\n`)
    writeFileSync(`${SQLDIR}/opp-t2.sql`,
      `insert into opportunities (referral_id, engagement, stage) values ('${REF}','warm_handoff','prospect');\n`)
    sh(`chmod 644 ${SQLDIR}/opp-t1.sql ${SQLDIR}/opp-t2.sql`)
    sh(`bash -c 'PSQL="runuser -u postgres -- psql -h /tmp/fsos-workshop-guarantee-log -p 55490 -U postgres -d ${DB} -t -A"; ($PSQL -f ${SQLDIR}/opp-t1.sql > /tmp/opp-t1.out 2>&1) & sleep 0.4; $PSQL -f ${SQLDIR}/opp-t2.sql > /tmp/opp-t2.out 2>&1; wait'`)
    const t1 = execSync('cat /tmp/opp-t1.out', { encoding: 'utf8' })
    const t2 = execSync('cat /tmp/opp-t2.out', { encoding: 'utf8' })
    ok('the first writer commits its placement', /INSERT 0 1/.test(t1), t1)
    ok('the second is REFUSED by the index — 23505 unique_violation, not a silent duplicate',
      /duplicate key value violates unique constraint "idx_opportunities_live_referral"/.test(t2), t2)
    ok('EXACTLY ONE live opportunity exists for the referral (the pipeline cannot double-count)',
      q(DB, `select count(*)::int::text from opportunities where referral_id='${REF}' and deleted_at is null`) === '1')
    ok('…and the survivor is the one that got there first (its source marker is intact)',
      q(DB, `select coalesce(source,'NULL') from opportunities where referral_id='${REF}' and deleted_at is null`) === 'workshop_attendance')
  }

  console.log('\nWhat the index must NOT block')
  {
    const REF2 = 'aaaa0002-0000-4000-8000-000000000002'
    q(DB, `insert into referrals (id, status) values ('${REF2}','received') on conflict do nothing`)
    q(DB, `insert into opportunities (referral_id, engagement, stage) values ('${REF2}','direct','prospect')`)
    ok('a SECOND referral gets its own opportunity — the index is per-referral, not global',
      q(DB, `select count(*)::int::text from opportunities where referral_id='${REF2}' and deleted_at is null`) === '1')
    // Referral-less opportunities (manual origination) are unconstrained.
    q(DB, `insert into opportunities (referral_id, engagement, stage) values (null,'direct','prospect')`)
    q(DB, `insert into opportunities (referral_id, engagement, stage) values (null,'direct','prospect')`)
    ok('TWO referral-less opportunities coexist — manual origination is not constrained',
      Number(q(DB, `select count(*)::int::text from opportunities where referral_id is null and deleted_at is null`)) >= 2)
    // A retired opportunity must not block a genuine re-conversion.
    q(DB, `update opportunities set deleted_at = now() where referral_id='${REF}'`)
    q(DB, `insert into opportunities (referral_id, engagement, stage) values ('${REF}','direct','prospect')`)
    ok('after the live one is retired, the referral can be converted again (partial index, not absolute)',
      q(DB, `select count(*)::int::text from opportunities where referral_id='${REF}' and deleted_at is null`) === '1')
  }

  console.log('\nMigration 134 collapses PRE-EXISTING duplicates before taking the index')
  {
    // Recreate the pre-migration world: drop the index, seed duplicates, re-apply 134.
    q(DB, `drop index idx_opportunities_live_referral`)
    const DUP = 'aaaa0003-0000-4000-8000-000000000003'
    q(DB, `insert into referrals (id, status) values ('${DUP}','received') on conflict do nothing`)
    q(DB, `insert into opportunities (referral_id, engagement, stage, source, created_at) values
             ('${DUP}','direct','prospect','workshop_attendance','2026-08-01T00:00:00Z'),
             ('${DUP}','warm_handoff','fact_find',null,'2026-08-02T00:00:00Z'),
             ('${DUP}','direct','prospect',null,'2026-08-03T00:00:00Z')`)
    ok('three live duplicates exist before the migration re-runs',
      q(DB, `select count(*)::int::text from opportunities where referral_id='${DUP}' and deleted_at is null`) === '3')
    const mig = execSync('cat supabase/migrations/134_opportunity_referral_dedupe.sql', { encoding: 'utf8' })
    writeFileSync(`${SQLDIR}/mig134.sql`, mig)
    sh(`chmod 644 ${SQLDIR}/mig134.sql`)
    execSync(`runuser -u postgres -- psql -h /tmp/fsos-workshop-guarantee-log -p 55490 -U postgres -d ${DB} -v ON_ERROR_STOP=1 -q -f ${SQLDIR}/mig134.sql`, { encoding: 'utf8' })
    ok('re-applying 134 over dirty data leaves exactly ONE live row',
      q(DB, `select count(*)::int::text from opportunities where referral_id='${DUP}' and deleted_at is null`) === '1')
    ok('…the EARLIEST is the survivor (the placement the convert route would have enriched)',
      q(DB, `select coalesce(source,'NULL') from opportunities where referral_id='${DUP}' and deleted_at is null`) === 'workshop_attendance')
    ok('…and the losers are SOFT-deleted, not destroyed (auditable, reversible)',
      q(DB, `select count(*)::int::text from opportunities where referral_id='${DUP}' and deleted_at is not null`) === '2')
    ok('the index is back after the collapse',
      q(DB, `select count(*)::int::text from pg_class where relname='idx_opportunities_live_referral'`) === '1')
  }

  console.log(`\n${passed} checks passed.`)
} catch (err) {
  console.error(`\n✗ FAILED after ${passed} checks:`, err.message)
  process.exitCode = 1
} finally {
  stopCluster(PGBIN)
}
