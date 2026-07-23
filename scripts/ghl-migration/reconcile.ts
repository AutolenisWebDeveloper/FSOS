// scripts/ghl-migration/reconcile.ts
// D0 — reconciliation report: row-count + checksum comparison proving the opt-out
// migration landed completely and ONLY in the enforcement stores. Run:
//   npx tsx scripts/ghl-migration/reconcile.ts --input ghl-optouts.json
//
// Reports (ADR-014 §2.A): input record count, planned enforceable channels, the
// applied counts in consents/dnc_entries tagged source/reason='ghl_migration', a
// leak check that NOTHING landed in consent_ledger, and a stable checksum over the
// migrated rows so before/after runs can be compared. Read-only.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { getDb, ConfigError } from '../../src/lib/supabase/client'
import { planOptOut, type GhlOptOutRecord } from '../../src/lib/comms/migration/ghl-optout'

interface Args { input?: string; help: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { help: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') a.input = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') a.help = true
  }
  return a
}
const USAGE = `D0 reconciliation report
  npx tsx scripts/ghl-migration/reconcile.ts --input ghl-optouts.json`

function checksum(rows: string[]): string {
  return createHash('md5').update(rows.slice().sort().join('\n')).digest('hex')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.input) { console.log(USAGE); process.exit(args.help ? 0 : 1) }

  const records = JSON.parse(readFileSync(args.input as string, 'utf8')) as GhlOptOutRecord[]

  // Offline expectation from the export alone (member unknown → dnc-only lower bound).
  let expectedChannels = 0
  for (const r of records) expectedChannels += planOptOut(r, null).channels.length

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = null
  try { db = getDb() } catch (e) {
    if (e instanceof ConfigError) {
      console.log(JSON.stringify({ input_records: records.length, expected_channels: expectedChannels, db: 'not-configured', note: 'Provide Supabase creds for the applied-row comparison + checksum.' }, null, 2))
      return
    }
    throw e
  }

  const { data: dncRows } = await db.from('dnc_entries').select('contact, channel, created_at').eq('reason', 'ghl_migration')
  const { data: consentRows } = await db.from('consents').select('member_id, channel, captured_at').eq('source', 'ghl_migration')
  // Leak check: consent_ledger must NOT be an enforcement target.
  const { count: ledgerLeak } = await db.from('consent_ledger').select('consent_id', { count: 'exact', head: true }).eq('source', 'ghl_migration')

  const dnc = (dncRows ?? []) as Array<{ contact: string; channel: string; created_at: string | null }>
  const con = (consentRows ?? []) as Array<{ member_id: string; channel: string; captured_at: string | null }>

  const report = {
    input_records: records.length,
    expected_channels_lower_bound: expectedChannels,
    applied: {
      dnc_entries_ghl_migration: dnc.length,
      consents_ghl_migration: con.length,
      total: dnc.length + con.length,
    },
    leak_check: {
      consent_ledger_ghl_migration: ledgerLeak ?? 0,
      ok: (ledgerLeak ?? 0) === 0, // MUST be 0 — consent_ledger is never an enforcement store
    },
    checksums: {
      dnc: checksum(dnc.map((r) => `${r.contact}|${r.channel}|${r.created_at ?? ''}`)),
      consents: checksum(con.map((r) => `${r.member_id}|${r.channel}|${r.captured_at ?? ''}`)),
    },
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.leak_check.ok) { console.error('\n✗ LEAK: opt-outs found in consent_ledger — they are NOT enforced there. Investigate.'); process.exit(2) }
  console.log('\n✓ reconciliation: enforcement stores only (consent_ledger clean).')
}

main().catch((e) => { console.error(e); process.exit(1) })
