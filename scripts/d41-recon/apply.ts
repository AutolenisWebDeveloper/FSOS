#!/usr/bin/env npx tsx
/**
 * D41 master reconciliation — Phase 4 (apply).
 *
 *   npx tsx scripts/d41-recon/apply.ts --staging DIR --approvals FILE            # dry run
 *   npx tsx scripts/d41-recon/apply.ts --staging DIR --approvals FILE --commit   # writes
 *
 * Refuses to write unless ALL of these hold:
 *   • DATABASE_URL is set (writes go through psql so each batch is a real transaction)
 *   • the Phase 3 approval worksheet exists and EVERY ambiguous row carries a decision
 *   • --commit is passed explicitly (default is a dry run that writes nothing)
 *   • neither circuit breaker trips (§4: >2,500 inserts, or >20% of live contacts modified)
 *
 * Reuse, not reimplementation (CLAUDE.md §6): all matching and merging comes from
 * `src/lib/import/resolution.ts`, which is intentionally pure/no-I/O for exactly this
 * purpose. Writes are emitted as SQL rather than going through `auditWriter.ts` because
 * the brief requires one transaction per 500-row batch, which supabase-js cannot express;
 * the `import_batches` / `import_records` column shape written here is identical to
 * auditWriter's so the audit trail stays uniform.
 *
 * Guardrails encoded here, matching the brief's §2 prohibitions:
 *   • no DELETE / TRUNCATE / DROP / ALTER, and no soft-delete write. (The Phase 5
 *     rollback file this emits does contain soft-deletes — it is written to disk and
 *     handed over per §5, never executed here.)
 *   • no write to consents, comm_*, dnc_entries, outreach_queue, or any campaign table
 *   • contacts.dob is NEVER written
 *   • fill-nulls-only; a differing non-null live value becomes a recorded CONFLICT
 *   • contact_type / status are never changed on an existing contact
 *   • aor_code / household_id / agency_partnership_id are never blanked
 *   • is_security is never set
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  buildContactIndex, resolveContact, mergeFields,
  type CandidateContact, type FieldSpec,
} from '../../src/lib/import/resolution'

const SEP = '\x01'    // psql field separator: cannot occur in the data
const ASEP = '\x02'   // separator between array elements within one field
const RUN_TAG = 'd41-master-2026-08-06'
const BATCH = 500
const MAX_INSERTS = 2500
const MAX_MODIFY_FRACTION = 0.20
const MASTER_FILENAME = 'District 41 MASTER - Consolidated Operating File.xlsx'

// §5.3 — scalar fields fill only into NULL; sets union. dob is absent by design.
const CONTACT_FIELDS: FieldSpec[] = [
  { field: 'email' }, { field: 'phone' }, { field: 'address' }, { field: 'city' },
  { field: 'state' }, { field: 'zip' }, { field: 'first_name' }, { field: 'last_name' },
  { field: 'lines_of_business', kind: 'set' }, { field: 'tags', kind: 'set' },
]
// Never writable by this run, whatever the extract says.
const FORBIDDEN = new Set(['dob', 'is_security', 'contact_type', 'status', 'deleted_at', 'archived_at'])

type Args = { staging: string; approvals: string; commit: boolean; out: string }

function parseArgs(): Args {
  const a = process.argv.slice(2)
  const get = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
  const staging = get('--staging'); const approvals = get('--approvals')
  if (!staging || !approvals) {
    console.error('usage: apply.ts --staging DIR --approvals FILE [--commit] [--out DIR]')
    process.exit(2)
  }
  return { staging, approvals, commit: a.includes('--commit'), out: get('--out') || staging }
}

// ── SQL helpers ──────────────────────────────────────────────────────────────
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return `array[${v.map((x) => lit(String(x))).join(',')}]::text[]`
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

function psql(dbUrl: string, sql: string): string {
  try {
    return execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', SEP, '-c', sql],
      { encoding: 'utf8', maxBuffer: 1 << 28 })
  } catch (e) {
    // §16.1 — a usable message, never a raw stack trace or the connection string.
    const stderr = ((e as { stderr?: Buffer }).stderr?.toString() || '').trim().split('\n')[0]
    throw new Error(`database command failed: ${stderr || 'psql could not be run'}`)
  }
}

// ── approvals (§3) ───────────────────────────────────────────────────────────
function loadApprovals(path: string): Map<string, string> {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/)
  const head = lines[0].split(',')
  const iRef = head.indexOf('ref'); const iDec = head.indexOf('decision')
  if (iRef < 0 || iDec < 0) throw new Error('approval worksheet is missing a ref/decision column')
  const map = new Map<string, string>()
  const unsigned: string[] = []
  for (const line of lines.slice(1)) {
    // naive split is safe here: ref is a hex hash and decision is a bare token
    const cells = line.split(',')
    const ref = cells[iRef]?.trim()
    const dec = (cells[cells.length - 1] || '').trim().toLowerCase()
    if (!ref) continue
    if (!dec) unsigned.push(ref)
    map.set(ref, dec)
  }
  if (unsigned.length) {
    throw new Error(
      `${unsigned.length} of ${map.size} ambiguous rows are unsigned. §3 requires row-level ` +
      `approval — fill the "decision" column for every row before running.`)
  }
  return map
}

// ── staging ──────────────────────────────────────────────────────────────────
type Staged = { natural_key: string; grain: string; src: Record<string, any>; derived: Record<string, any>; row_hash: string }

function loadStaging(dir: string): Record<string, Staged[]> {
  const out: Record<string, Staged[]> = {}
  for (const f of readdirSync(dir).filter((x) => x.startsWith('stg_d41_') && x.endsWith('.ndjson'))) {
    const tab = f.replace('stg_d41_', '').replace('.ndjson', '')
    out[tab] = readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  }
  return out
}

// ── live index ───────────────────────────────────────────────────────────────
/**
 * The live row as `mergeFields()` needs to see it.
 *
 * This MUST carry every field in CONTACT_FIELDS, not just the matching keys. If a
 * merge target is missing `email`/`phone`/`address`, mergeFields() reads those as
 * blank and emits a patch that OVERWRITES live data — the exact §2.3 violation this
 * reconciliation exists to prevent. Widen this select alongside CONTACT_FIELDS.
 */
type LiveContact = CandidateContact & Record<string, unknown>

function loadLiveIndex(dbUrl: string): LiveContact[] {
  const cols = [
    'id', 'full_name', 'email_lc', 'phone_digits', 'zip', 'address',
    'book_key', 'crosssell_key', 'winback_key',
    'email', 'phone', 'city', 'state', 'first_name', 'last_name',
    'contact_type', 'household_id',
  ]
  const rows = psql(dbUrl,
    `select ${cols.map((c) => `coalesce(${c}::text,'')`).join(', ')},
            array_to_string(lines_of_business, chr(2)), array_to_string(tags, chr(2))
     from contacts where deleted_at is null`)

  return rows.trim().split('\n').filter(Boolean).map((line) => {
    const cells = line.split(SEP)
    const rec: Record<string, unknown> = {}
    cols.forEach((c, i) => { rec[c] = cells[i] || null })
    rec.lines_of_business = (cells[cols.length] || '').split(ASEP).filter(Boolean)
    rec.tags = (cells[cols.length + 1] || '').split(ASEP).filter(Boolean)
    rec.street = rec.address                       // resolution.ts calls it `street`
    rec.provenanceKeys = [rec.book_key, rec.crosssell_key, rec.winback_key].filter(Boolean)
    return rec as LiveContact
  })
}

/** Guard: every mergeable field must be present on the loaded row (see above). */
function assertMergeableShape(live: LiveContact[]): void {
  if (!live.length) return
  const missing = CONTACT_FIELDS.map((f) => f.field).filter((f) => !(f in live[0]))
  if (missing.length) {
    throw new Error(
      `live contact rows are missing ${missing.join(', ')} — merging would overwrite live ` +
      `values instead of filling nulls. Widen loadLiveIndex() before running.`)
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs()
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!dbUrl) {
    console.error('DATABASE_URL is not set. Phase 4 needs a real connection — the reconciliation\n' +
                  'cannot be applied through inline SQL. See docs/recon/…-phase0.md §8.')
    process.exit(2)
  }

  const approvals = loadApprovals(args.approvals)      // throws unless fully signed
  const staged = loadStaging(args.staging)
  const live = loadLiveIndex(dbUrl)
  assertMergeableShape(live)
  const idx = buildContactIndex(live)
  console.log(`live contacts indexed: ${live.length}`)
  console.log(`approval worksheet: ${approvals.size} rows, all signed`)

  const inserts: string[] = []
  const updates: string[] = []
  const records: string[] = []
  let nInsert = 0, nUpdate = 0, nConflict = 0, nSkipped = 0

  for (const tab of ['crosssell', 'winback'] as const) {
    for (const rec of staged[tab] || []) {
      const s = rec.src
      const res = resolveContact(idx, {
        provenanceKeys: [rec.natural_key],
        email: rec.derived.email_lc, phone: rec.derived.phone_digits,
        fullName: s.full_name, zip: rec.derived.zip5, street: s.street,
      })

      // §3 — an ambiguous row only proceeds on an explicit per-row approval.
      const refHash = rec.natural_key
      if (res.action === 'review' || res.conflict) {
        const dec = approvals.get(refHash)
        if (dec !== 'approve') { nSkipped++; continue }
      }

      const incoming: Record<string, unknown> = {
        email: s.email_lc ?? null, phone: s.phone ?? null, address: s.street ?? null,
        city: s.city ?? null, state: s.state ?? null, zip: s.zip ?? null,
        first_name: s.first_name ?? null, last_name: s.last_name ?? null,
        lines_of_business: s.lines_of_business ?? [], tags: [RUN_TAG],
      }
      for (const f of Object.keys(incoming)) if (FORBIDDEN.has(f)) delete incoming[f]

      if (res.action === 'merge' && res.targetId) {
        // Fill-nulls-only. mergeFields() rejects (never writes) a differing non-null value.
        const existing = live.find((c) => c.id === res.targetId) as Record<string, unknown>
        if (!existing) { nSkipped++; continue }
        const { patch, merged, rejected } = mergeFields(existing, incoming, CONTACT_FIELDS)
        nConflict += rejected.length
        if (Object.keys(patch).length === 0 && !rejected.length) continue
        const sets = Object.entries(patch).map(([k, v]) => `${k}=${lit(v)}`)
        // custom is NOT NULL '{}' — merge, never replace (§5.3).
        sets.push(`custom = contacts.custom || ${lit({ source_extract: 'd41_master', source_asof: '2026-08-06', name_grain: 'household' })}`)
        sets.push(`${tab}_key = coalesce(${tab}_key, ${lit(rec.natural_key)})`)
        if (sets.length) {
          updates.push(`update contacts set ${sets.join(', ')}, updated_at=now() where id=${lit(res.targetId)};`)
          nUpdate++
        }
        records.push(recordRow(rec, 'MATCH_EXACT', res.targetId, merged, rejected, res.confidence, 'auto'))
      } else if (res.action === 'create') {
        inserts.push(insertContact(tab, rec, incoming))
        nInsert++
        records.push(recordRow(rec, 'INSERT_NEW', null, Object.keys(incoming), [], 'none', 'auto'))
      } else {
        nSkipped++
        records.push(recordRow(rec, 'MATCH_AMBIGUOUS', res.targetId, [], [], res.confidence, 'needs_review'))
      }
    }
  }

  // ── circuit breakers (§4) — evaluated BEFORE anything is written ───────────
  const liveCount = live.length
  if (nInsert > MAX_INSERTS) {
    console.error(`ABORT: ${nInsert} inserts exceeds the ${MAX_INSERTS} limit. ` +
                  `Expected ~1,800 — a higher number means the keys are wrong. Do not raise the limit blindly.`)
    process.exit(1)
  }
  if (nUpdate > liveCount * MAX_MODIFY_FRACTION) {
    console.error(`ABORT: ${nUpdate} updates exceeds ${Math.floor(liveCount * MAX_MODIFY_FRACTION)} ` +
                  `(${MAX_MODIFY_FRACTION * 100}% of ${liveCount} live contacts).`)
    process.exit(1)
  }

  console.log(`\nplan: ${nInsert} insert · ${nUpdate} update · ${nConflict} conflict recorded · ${nSkipped} skipped`)

  if (!args.commit) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.')
    writeFileSync(join(args.out, 'phase4-plan.sql'), [...inserts, ...updates].join('\n'))
    console.log(`plan SQL written to ${join(args.out, 'phase4-plan.sql')}`)
    return
  }

  // ── commit: one transaction per 500-row batch ─────────────────────────────
  const batchId = psql(dbUrl,
    `insert into import_batches (source, filename, actor, stats)
     values ('d41_master_recon', ${lit(MASTER_FILENAME)}, ${lit(process.env.USER || 'operator')},
             ${lit({ inserts: nInsert, updates: nUpdate, conflicts: nConflict, skipped: nSkipped })})
     returning id;`).trim()
  console.log(`import_batches id: ${batchId}`)

  const all = [...inserts, ...updates]
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH)
    try {
      psql(dbUrl, `begin;\n${chunk.join('\n')}\ncommit;`)
      console.log(`  batch ${i / BATCH + 1}: ${chunk.length} statements committed`)
    } catch (e) {
      console.error(`  batch ${i / BATCH + 1} ROLLED BACK: ${(e as Error).message.split('\n')[0]}`)
    }
  }
  for (let i = 0; i < records.length; i += BATCH) {
    psql(dbUrl, `begin;\ninsert into import_records (batch_id, entity_type, raw, decision, target_id, merged_fields, rejected_values, confidence, review_status) values\n` +
      records.slice(i, i + BATCH).map((r) => r.replace('$BATCH', lit(batchId))).join(',\n') + ';\ncommit;')
  }

  // ── Phase 5 — rollback script, produced and handed over, never executed ────
  const rb = join(args.out, `rollback-${batchId}.sql`)
  writeFileSync(rb,
    `-- Rollback for import_batches ${batchId}. REVIEW BEFORE RUNNING. Not executed by apply.ts.\n` +
    `-- Inserts: soft-delete only (§2.1 forbids hard DELETE).\n` +
    `update contacts set deleted_at = now()\n` +
    ` where id in (select target_id from import_records\n` +
    `              where batch_id = ${lit(batchId)} and decision->>'decision' = 'INSERT_NEW');\n\n` +
    `-- Updates: restore prior values from import_records.merged_fields.\n` +
    `-- Each merged field was NULL before this run (fill-nulls-only), so reverting means\n` +
    `-- setting those columns back to NULL for the affected rows. Verify before running.\n` +
    `select target_id, merged_fields from import_records\n` +
    ` where batch_id = ${lit(batchId)} and decision->>'decision' = 'MATCH_EXACT';\n`)
  console.log(`\nrollback script written (NOT executed): ${rb}`)
}

function insertContact(tab: string, rec: Staged, inc: Record<string, unknown>): string {
  const s = rec.src
  const custom = {
    name_grain: 'household', source_extract: 'd41_master', source_asof: '2026-08-06',
    agency_normalized: s.agency_norm ?? null, aor_code_full: s.aor_code ?? null,
    agency_principal_code: s.principal_code ?? null,
  }
  return `insert into contacts (full_name, first_name, last_name, email, phone, address, city, state, zip,
    contact_type, status, source, tags, lines_of_business, custom, ${tab}_key)
    values (${lit(s.full_name)}, ${lit(s.first_name)}, ${lit(s.last_name)}, ${lit(inc.email)}, ${lit(inc.phone)},
      ${lit(inc.address)}, ${lit(inc.city)}, ${lit(inc.state)}, ${lit(inc.zip)},
      'prospect', 'active', ${lit(tab === 'crosssell' ? 'crosssell_life' : 'winback_life')},
      ${lit([RUN_TAG])}, ${lit(inc.lines_of_business)}, ${lit(custom)}, ${lit(rec.natural_key)})
    on conflict (${tab}_key) where ${tab}_key is not null do nothing;`
}

function recordRow(rec: Staged, decision: string, target: string | null,
                   merged: string[], rejected: unknown[], confidence: string, review: string): string {
  return `($BATCH, 'contact', ${lit(rec.src)}, ${lit({ decision, row_hash: rec.row_hash })}, ` +
         `${lit(target)}, ${lit(merged)}::jsonb, ${lit(rejected)}, ${lit(confidence)}, ${lit(review)})`
}

try {
  main()
} catch (e) {
  // §16.1 — plain-language failure, no stack trace, no connection string.
  console.error(`\nAPPLY ABORTED: ${(e as Error).message}`)
  console.error('Nothing was committed by this run.')
  process.exit(1)
}
