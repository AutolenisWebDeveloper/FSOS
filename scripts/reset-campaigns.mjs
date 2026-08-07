#!/usr/bin/env node
// FSOS — full execution-data reset for the three campaigns, then restart.
//
// Campaigns in scope (CLAUDE.md §19 — ADR-029 life-conversion, ADR-031, ADR-032):
//   • Life Conversion      (life_campaigns / life_campaign_*)
//   • Pipeline Win-Back    (pipeline_winback_campaigns / pipeline_winback_*)
//   • Cross-Sell Life      (xsell_life_campaigns / xsell_life_*)
//
// WHAT THIS PURGES — per-contact execution state only:
//   enrollments (which FK-cascade to executions and advisor-touch rows) and the
//   pending AI-agent outreach queue. Deleting an enrollment takes its timeline
//   cursor, current_touch_no, next_touch_at and every touch record with it, so a
//   re-enrolled contact starts at touch 0 with no prior campaign activity.
//
// WHAT THIS PRESERVES — asserted, not assumed (see PRESERVED below):
//   Contacts, households, members, policies. comm_templates (email + SMS copy)
//   and the campaign touch templates that reference them — those are the sequence
//   blueprint, i.e. configuration, not execution data, and a restart needs them.
//   consents / comm_contact_consents / dnc_entries (TCPA + suppression record).
//   comm_messages, comm_conversations, comm_message_events — the per-message
//   send/delivery record and inbound threads. These are the CAN-SPAM / TCPA /
//   A2P proof-of-send and STOP-evidence trail (CLAUDE.md §12, §13.9) and are the
//   "legally required compliance and audit logs" the reset must not touch.
//   audit_log and compliance_events (append-only by construction, migration 077).
//
// The script FAILS CLOSED: if any preserved table's row count moves, it reports a
// preservation breach instead of a success.
//
// Usage:
//   node scripts/reset-campaigns.mjs            # dry run — reports, mutates nothing
//   node scripts/reset-campaigns.mjs --apply    # perform the reset + restart
//
// Env (never logged): NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL  and
//                     SUPABASE_SERVICE_KEY     | SUPABASE_SERVICE_ROLE_KEY
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── The reset contract, as data ────────────────────────────────────────────────
// PURGED: the root execution table per family. Children are omitted deliberately —
// they carry `on delete cascade` (migrations 081/083/085), so listing them as
// separate deletes would be a second, drift-prone source of truth. They are
// verified empty afterwards instead.
export const PURGED = [
  { family: 'life_conversion', table: 'life_campaign_enrollments', cascades: ['life_campaign_executions', 'life_advisor_touches'] },
  { family: 'pipeline_winback', table: 'pipeline_winback_enrollments', cascades: ['pipeline_winback_executions', 'pipeline_winback_advisor_touches'] },
  { family: 'cross_sell_life', table: 'xsell_life_campaign_enrollments', cascades: ['xsell_life_campaign_executions', 'xsell_life_advisor_touches'] },
]

// Pending agent work only. 'blocked' rows are the compliance gate's record of why
// a send was stopped — that is gate-decision evidence (§13.9), not pending work,
// so it survives the reset.
export const QUEUE_PURGE = { table: 'outreach_queue', deleteWhereStatus: ['queued'], keepStatus: ['blocked', 'sent', 'drafted', 'escalated', 'skipped', 'held'] }

// Every one of these must have an identical count before and after.
export const PRESERVED = [
  'contacts', 'households', 'household_members', 'household_policies',
  'comm_templates', 'comm_template_versions',
  'life_campaign_touches', 'pipeline_winback_touches', 'xsell_life_campaign_touches',
  'consents', 'comm_contact_consents', 'dnc_entries',
  'comm_messages', 'comm_conversations', 'comm_message_events',
  'compliance_events',
]

// audit_log is preserved but INTENTIONALLY grows (this reset writes to it), so it
// is verified as append-only rather than as unchanged.
export const APPEND_ONLY = ['audit_log']

/**
 * Pure: given before/after counts, decide whether the reset satisfied its contract.
 * Extracted so tests/campaign-reset-contract.test.mjs can prove the rules without a DB.
 */
export function verifyReset(before, after) {
  const problems = []

  for (const { family, table, cascades } of PURGED) {
    if ((after[table] ?? 0) !== 0) problems.push(`${family}: ${table} still has ${after[table]} row(s)`)
    for (const child of cascades) {
      if ((after[child] ?? 0) !== 0) problems.push(`${family}: ${child} did not cascade — ${after[child]} row(s) remain`)
    }
  }

  for (const table of PRESERVED) {
    const b = before[table] ?? 0
    const a = after[table] ?? 0
    if (a !== b) problems.push(`PRESERVATION BREACH: ${table} moved ${b} → ${a}`)
  }

  for (const table of APPEND_ONLY) {
    const b = before[table] ?? 0
    const a = after[table] ?? 0
    if (a < b) problems.push(`APPEND-ONLY BREACH: ${table} shrank ${b} → ${a}`)
  }

  return { ok: problems.length === 0, problems }
}

/** Pure: the counted table list, deduped — before/after snapshots use the same set. */
export function countedTables() {
  const t = new Set()
  for (const p of PURGED) { t.add(p.table); for (const c of p.cascades) t.add(c) }
  t.add(QUEUE_PURGE.table)
  for (const p of PRESERVED) t.add(p)
  for (const p of APPEND_ONLY) t.add(p)
  t.add('life_campaigns'); t.add('pipeline_winback_campaigns'); t.add('xsell_life_campaigns')
  return [...t].sort()
}

// ── Runner ─────────────────────────────────────────────────────────────────────
function loadEnvLocal() {
  const path = join(root, '.env.local')
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = val
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  loadEnvLocal()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY. Set them in .env.local and re-run.')
    process.exit(1)
  }
  const { createClient } = await import('@supabase/supabase-js')
  const db = createClient(url, key, { auth: { persistSession: false } })

  const snapshot = async () => {
    const out = {}
    for (const table of countedTables()) {
      const { count, error } = await db.from(table).select('id', { count: 'exact', head: true })
      out[table] = error ? null : (count ?? 0)
    }
    return out
  }

  const before = await snapshot()
  console.log('\nBefore:')
  for (const [t, n] of Object.entries(before)) console.log(`  ${t.padEnd(36)} ${n}`)

  if (!apply) {
    console.log('\nDry run — nothing was changed. Re-run with --apply to perform the reset.')
    return
  }

  // 1. Purge execution state. Children go via `on delete cascade`.
  for (const { family, table } of PURGED) {
    const { error } = await db.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) { console.error(`FAILED purging ${table}: ${error.message}`); process.exit(1) }
    await db.from('audit_log').insert({
      actor: 'system', action: 'entity.deleted', entity: table, entity_id: null,
      diff: { reason: 'campaign_reset', family, purged_rows: before[table] },
    })
    console.log(`  purged ${table} (${before[table]} rows)`)
  }

  // 2. Pending outreach queue only.
  const { error: qErr } = await db.from(QUEUE_PURGE.table).delete().in('status', QUEUE_PURGE.deleteWhereStatus)
  if (qErr) { console.error(`FAILED purging ${QUEUE_PURGE.table}: ${qErr.message}`); process.exit(1) }
  await db.from('audit_log').insert({
    actor: 'system', action: 'entity.deleted', entity: QUEUE_PURGE.table, entity_id: null,
    diff: { reason: 'campaign_reset', deleted_status: QUEUE_PURGE.deleteWhereStatus, kept_status: QUEUE_PURGE.keepStatus },
  })

  // 3. Restart. Life Conversion and Pipeline Win-Back have no version column and
  //    were already 'active' — a cleared enrollment set is the whole restart for
  //    them. Cross-Sell Life v1 was 'emergency_stopped'; states.ts allows
  //    emergency_stopped → active via 'enable', so it is re-enabled in place
  //    rather than cloned to a new version (a clone would duplicate v1's 35
  //    touches for no gain). v2 stays 'archived' — archived is terminal.
  //    emergency_stopped_at/_by are deliberately NOT cleared: applyControl()
  //    leaves them as the historical record of the stop, and only re-versioning
  //    clears them.
  const { data: enabled } = await db
    .from('xsell_life_campaigns')
    .update({ status: 'active', activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('status', 'emergency_stopped') // compare-and-set — matches applyControl's TOCTOU guard
    .select('id, resume_behavior, replay_policy')
  for (const c of enabled ?? []) {
    await db.from('audit_log').insert({
      actor: 'system', action: 'config.changed', entity: 'xsell_life_campaign', entity_id: c.id,
      diff: {
        control: 'enable', prev: 'emergency_stopped', next: 'active', reason: 'campaign_reset_restart',
        resume_behavior: c.resume_behavior, replay_policy: c.replay_policy,
        enrollments_paused: null, enrollments_resumed: 0, enrollments_restarted: null,
      },
    })
    console.log(`  re-enabled xsell_life_campaign ${c.id} (emergency_stopped → active)`)
  }

  // 4. Verify the contract held before declaring anything reset.
  const after = await snapshot()
  const result = verifyReset(before, after)
  console.log('\nAfter:')
  for (const [t, n] of Object.entries(after)) console.log(`  ${t.padEnd(36)} ${n}`)

  if (!result.ok) {
    console.error('\nRESET VERIFICATION FAILED:')
    for (const p of result.problems) console.error('  ✗', p)
    process.exit(1)
  }
  console.log('\n✓ Reset verified: execution data cleared, every preserved table intact.')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
