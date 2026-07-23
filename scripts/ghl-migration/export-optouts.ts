// scripts/ghl-migration/export-optouts.ts
// D0 — normalize a RAW GoHighLevel export into the canonical opt-out record shape
// the importer consumes. Run: npx tsx scripts/ghl-migration/export-optouts.ts --input raw.json --out ghl-optouts.json
//
// This does NOT call the live GHL API (ADR-014 D0: build tooling, do not execute
// against live GHL). The operator downloads a DND/opt-out export from GHL (or pulls
// it with their own credentials) and points --input at that JSON. This script maps
// GHL's assorted field names onto { ghl_contact_id, email, phone, channel, opted_out_at }.
//
// To pull from the GHL API instead (when credentials exist), the endpoint is
// GET {GHL_API_BASE}/contacts/?locationId=... filtered to DND/opt-out; wire that in a
// follow-up only behind an explicit --live flag. Intentionally omitted here.
import { readFileSync, writeFileSync } from 'node:fs'
import type { GhlOptOutRecord } from '../../src/lib/comms/migration/ghl-optout'

interface Args { input?: string; out?: string; help: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { help: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') a.input = argv[++i]
    else if (argv[i] === '--out') a.out = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') a.help = true
  }
  return a
}

const USAGE = `D0 GHL opt-out export normalizer (no live GHL call)
  npx tsx scripts/ghl-migration/export-optouts.ts --input raw-ghl-export.json [--out ghl-optouts.json]

Reads a raw GHL DND/opt-out export (JSON array) and emits canonical records
{ ghl_contact_id, email, phone, channel, opted_out_at }. --out defaults to stdout.`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>

function first<T>(...vals: T[]): T | null {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v
  return null
}

// GHL exports vary (native contact export vs DND webhook dumps). Accept the common shapes.
function normalize(r: Raw): GhlOptOutRecord | null {
  const ghl_contact_id = first<string>(r.id, r.contactId, r.contact_id, r?.contact?.id) ?? null
  const email = first<string>(r.email, r?.contact?.email) ?? null
  const phone = first<string>(r.phone, r.phoneNumber, r?.contact?.phone) ?? null
  // Channel: explicit dnd channel, or infer from dnd flags (dndEmail/dndSms) → 'all' when both.
  let channel = first<string>(r.channel, r?.dnd?.channel, r.dndChannel)
  if (!channel) {
    const dndSms = !!(r.dndSms ?? r.dnd_sms ?? r.dnd)
    const dndEmail = !!(r.dndEmail ?? r.dnd_email)
    channel = dndSms && dndEmail ? 'all' : dndEmail ? 'email' : dndSms ? 'sms' : 'all'
  }
  const opted_out_at =
    first<string>(r.opted_out_at, r.optedOutAt, r.dndUpdatedAt, r.dateUpdated, r.updatedAt, r.dateAdded) ?? null

  if (!ghl_contact_id && !email && !phone) return null // nothing to key on — skip (report separately)
  return { ghl_contact_id, email, phone, channel, opted_out_at }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.input) { console.log(USAGE); process.exit(args.help ? 0 : 1) }

  const raw = JSON.parse(readFileSync(args.input as string, 'utf8'))
  const rows: Raw[] = Array.isArray(raw) ? raw : Array.isArray(raw?.contacts) ? raw.contacts : []
  const out: GhlOptOutRecord[] = []
  let skipped = 0
  for (const r of rows) { const n = normalize(r); if (n) out.push(n); else skipped++ }

  const json = JSON.stringify(out, null, 2)
  if (args.out) { writeFileSync(args.out, json); console.error(`Wrote ${out.length} records to ${args.out} (${skipped} unkeyable skipped).`) }
  else { process.stdout.write(json + '\n'); console.error(`Normalized ${out.length} records (${skipped} unkeyable skipped).`) }
}

main()
