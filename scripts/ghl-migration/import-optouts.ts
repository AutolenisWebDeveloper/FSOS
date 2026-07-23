// scripts/ghl-migration/import-optouts.ts
// D0 — migrate GHL DND/opt-out/unsubscribe records into the FSOS enforcement
// stores (consents + dnc_entries). Run: npx tsx scripts/ghl-migration/import-optouts.ts
//
//   --input <file>   JSON array of raw GHL opt-out records (required)
//   --commit         apply writes (DEFAULT: dry-run — reads only, writes nothing)
//   --help
//
// Safety contract (ADR-014 D0):
//   • DRY-RUN BY DEFAULT — no writes unless --commit is passed.
//   • Credentials at runtime — getDb() reads env; no creds embedded.
//   • Opt-outs land in consents (revoked) and/or dnc_entries — NEVER consent_ledger.
//   • Member-resolved → consents revoke (insert-only-when-absent, rollback-clean) +
//     dnc_entries. Unresolvable member → FAIL CLOSED to dnc_entries (contact-keyed,
//     needs no member). No member AND no contact value → recorded UNRESOLVED (must be
//     zero to exit D0).
//   • Idempotent — dnc_entries on-conflict-do-nothing; consents on-conflict-do-nothing.
//   • Original GHL timestamps preserved (created_at / captured_at), never now().
import { readFileSync } from 'node:fs'
import { getDb, ConfigError } from '../../src/lib/supabase/client'
import { writeAudit } from '../../src/lib/audit/log'
import {
  planOptOut,
  type GhlOptOutRecord,
  type ResolvedMember,
  type OptOutChannel,
} from '../../src/lib/comms/migration/ghl-optout'

interface Args { input?: string; commit: boolean; help: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { commit: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') a.input = argv[++i]
    else if (argv[i] === '--commit') a.commit = true
    else if (argv[i] === '--help' || argv[i] === '-h') a.help = true
  }
  return a
}

const USAGE = `D0 GHL opt-out import (dry-run by default)
  npx tsx scripts/ghl-migration/import-optouts.ts --input ghl-optouts.json [--commit]

Input: JSON array of { ghl_contact_id?, email?, phone?, channel?, opted_out_at? }.
Dry-run prints the plan + summary and writes NOTHING. --commit applies idempotently.`

export interface ImportSummary {
  mode: 'dry-run' | 'commit'
  records: number
  channels_planned: number
  member_resolved: number
  fail_closed_dnc: number
  unresolved: number
  dnc_writes: number
  consent_writes: number
  applied_dnc: number
  applied_consents: number
  skipped_idempotent: number
}

// Best-effort GHL contact → household member resolution. Consent is member-keyed,
// so we resolve the person: by email, then phone, then via households.ghl_contact_id.
// Returns null when no member can be found (caller then fail-closes to dnc_entries).
async function resolveMember(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  rec: GhlOptOutRecord,
): Promise<ResolvedMember | null> {
  const email = (rec.email ?? '').trim().toLowerCase() || null
  const phone = (rec.phone ?? '').trim() || null

  if (email) {
    const { data } = await db.from('household_members').select('id, household_id').eq('email', email).limit(1).maybeSingle()
    if (data) return { member_id: data.id, household_id: data.household_id ?? null }
  }
  if (phone) {
    const { data } = await db.from('household_members').select('id, household_id').eq('phone', phone).limit(1).maybeSingle()
    if (data) return { member_id: data.id, household_id: data.household_id ?? null }
  }
  if (rec.ghl_contact_id) {
    const { data: hh } = await db.from('households').select('id').eq('ghl_contact_id', rec.ghl_contact_id).limit(1).maybeSingle()
    if (hh) {
      // Prefer a member matching the contact info; else the first member of the household.
      let q = db.from('household_members').select('id, household_id').eq('household_id', hh.id)
      if (email) q = q.eq('email', email)
      const { data: m } = await q.limit(1).maybeSingle()
      if (m) return { member_id: m.id, household_id: m.household_id ?? null }
      const { data: any1 } = await db.from('household_members').select('id, household_id').eq('household_id', hh.id).limit(1).maybeSingle()
      if (any1) return { member_id: any1.id, household_id: any1.household_id ?? null }
    }
  }
  return null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.input) { console.log(USAGE); process.exit(args.help ? 0 : 1) }

  const records = JSON.parse(readFileSync(args.input as string, 'utf8')) as GhlOptOutRecord[]
  if (!Array.isArray(records)) { console.error('Input must be a JSON array of records.'); process.exit(1) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = null
  try { db = getDb() } catch (e) {
    if (e instanceof ConfigError && !args.commit) {
      console.warn('⚠ No Supabase credentials — dry-run will treat every record as member-unresolved (fail-closed plan).')
    } else { console.error('Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY.'); process.exit(1) }
  }

  const s: ImportSummary = {
    mode: args.commit ? 'commit' : 'dry-run',
    records: records.length, channels_planned: 0, member_resolved: 0, fail_closed_dnc: 0,
    unresolved: 0, dnc_writes: 0, consent_writes: 0, applied_dnc: 0, applied_consents: 0, skipped_idempotent: 0,
  }
  const unresolvedRecords: GhlOptOutRecord[] = []

  for (const rec of records) {
    const member = db ? await resolveMember(db, rec) : null
    const plan = planOptOut(rec, member)
    s.channels_planned += plan.channels.length
    if (member) s.member_resolved++
    if (plan.unresolved) { s.unresolved++; unresolvedRecords.push(rec) }

    for (const w of plan.writes) {
      if (w.target === 'dnc_entries') {
        s.dnc_writes++
        if (!member) s.fail_closed_dnc++
        if (args.commit && db) {
          const { error, count } = await db
            .from('dnc_entries')
            .upsert(
              { contact: w.contact, channel: w.channel, scope: w.scope, reason: w.reason, created_at: w.created_at ?? undefined },
              { onConflict: 'contact,channel', ignoreDuplicates: true, count: 'exact' },
            )
          if (error) { console.error(`dnc_entries upsert failed for ${w.contact}/${w.channel}: ${error.message}`); continue }
          if (count && count > 0) s.applied_dnc++; else s.skipped_idempotent++
        }
      } else {
        s.consent_writes++
        if (args.commit && db) {
          const { error, count } = await db
            .from('consents')
            .upsert(
              { member_id: w.member_id, household_id: w.household_id, channel: w.channel, status: w.status, source: w.source, captured_at: w.captured_at ?? undefined },
              { onConflict: 'member_id,channel', ignoreDuplicates: true, count: 'exact' },
            )
          if (error) { console.error(`consents upsert failed for member ${w.member_id}/${w.channel}: ${error.message}`); continue }
          if (count && count > 0) s.applied_consents++; else s.skipped_idempotent++
        }
      }
    }
  }

  if (args.commit && db) {
    await writeAudit({
      actor: 'script:ghl-optout-import',
      action: 'consent.revoked',
      entity: 'consent',
      diff: { source: 'ghl_migration', applied_dnc: s.applied_dnc, applied_consents: s.applied_consents, unresolved: s.unresolved },
    }).catch(() => { /* audit is best-effort; never block the migration */ })
  }

  console.log(JSON.stringify(s, null, 2))
  if (s.unresolved > 0) {
    console.error(`\n✗ ${s.unresolved} UNRESOLVED opt-out(s) — no member and no contact value. D0 exit requires ZERO.`)
    console.error('  Create verification tasks for these before proceeding:')
    console.error(JSON.stringify(unresolvedRecords, null, 2))
    process.exit(2)
  }
  console.log(`\n✓ ${s.mode}: ${s.dnc_writes} dnc + ${s.consent_writes} consent writes planned (${s.fail_closed_dnc} fail-closed), 0 unresolved.`)
  if (!args.commit) console.log('  (dry-run — nothing written. Re-run with --commit to apply.)')
}

main().catch((e) => { console.error(e); process.exit(1) })
