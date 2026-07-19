import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { parseCsvRecords } from '@/lib/csv'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GHL Contact Upload (docs/legacy-port.md §2.6) — folds into the Admin import
// wizard. GHL contacts → households + household_members (+ consent). Flow:
//   preview  → parse/map/validate/dedupe, persist an import_jobs(preview) with a
//              rollback token; returns the exact changes (no writes to the spine)
//   commit   → insert the previewed rows, record created ids for rollback
//   rollback → delete everything the commit created, restore pre-import state
//
// GUARDRAILS: never imports securities data (only name/email/phone/consent are
// mapped). A contact with NO consent is imported but flagged and unsendable — the
// comms gate blocks it because no consents row exists. Idempotent: re-previewing
// after commit re-classifies the same contacts as duplicates.
//
// NOTE (guardrail §2.3): there is no verified GHL API, so this is the labeled
// CSV/paste fallback, not an invented live sync.

const MAX_ROWS = 2000
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB CSV

interface Candidate {
  full_name: string
  email: string | null
  phone: string | null
  consent_channels: string[]
}

const norm = (s: string | undefined) => (s ?? '').trim()
const lc = (s: string | undefined) => norm(s).toLowerCase()

/** Find the first present value among candidate header names (case-insensitive). */
function field(row: Record<string, string>, keys: string[]): string {
  const map = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]))
  for (const k of keys) {
    const real = map.get(k.toLowerCase())
    if (real && norm(row[real])) return norm(row[real])
  }
  return ''
}

function consentFrom(row: Record<string, string>): string[] {
  const channels = new Set<string>()
  const emailC = lc(field(row, ['consent_email', 'email_consent', 'emailoptin']))
  const smsC = lc(field(row, ['consent_sms', 'sms_consent', 'smsoptin', 'phone_consent']))
  const generic = lc(field(row, ['consent', 'opt_in', 'optin']))
  const tags = lc(field(row, ['tags']))
  if (['yes', 'true', '1', 'email', 'both'].includes(emailC)) channels.add('email')
  if (['yes', 'true', '1', 'sms', 'both'].includes(smsC)) channels.add('sms')
  if (['email', 'both', 'yes', 'true', '1'].includes(generic)) channels.add('email')
  if (['sms', 'both'].includes(generic)) channels.add('sms')
  if (tags.includes('consent-email') || tags.includes('email-consent')) channels.add('email')
  if (tags.includes('consent-sms') || tags.includes('sms-consent')) channels.add('sms')
  return Array.from(channels)
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('admin')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['admin', 'ops', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<{ mode?: string; csv?: string; job_id?: string; token?: string }>(req, MAX_BYTES)
  if ('error' in parsed) return parsed.error
  const mode = parsed.data.mode
  const actor = actorOf(auth.session)

  try {
    const db = getDb()

    // ── PREVIEW ──────────────────────────────────────────────────────────────
    if (mode === 'preview') {
      const csv = parsed.data.csv
      if (!csv || !csv.trim()) return NextResponse.json({ error: 'Paste or upload CSV first.' }, { status: 400 })
      const table = parseCsvRecords(csv)
      if (table.rows.length === 0) return NextResponse.json({ error: 'No data rows found.' }, { status: 400 })

      const truncated = table.rows.length > MAX_ROWS
      const rows = table.rows.slice(0, MAX_ROWS)

      const importable: Candidate[] = []
      const errors: { row: number; reason: string }[] = []
      const seenEmails = new Set<string>()
      const seenPhones = new Set<string>()
      let duplicateInFile = 0

      // Pre-parse candidates + collect keys for a single existing-contact lookup.
      const staged: (Candidate | null)[] = rows.map((r, i) => {
        const first = field(r, ['first_name', 'firstname', 'first'])
        const last = field(r, ['last_name', 'lastname', 'last'])
        const full = field(r, ['name', 'full_name', 'fullname', 'contact_name']) || [first, last].filter(Boolean).join(' ')
        const email = lc(field(r, ['email', 'email_address'])) || null
        const phone = field(r, ['phone', 'phone_number', 'mobile', 'cell']) || null
        if (!full) {
          errors.push({ row: i + 2, reason: 'Missing name' })
          return null
        }
        if (!email && !phone) {
          errors.push({ row: i + 2, reason: 'Missing email and phone' })
          return null
        }
        // De-dupe within the file itself.
        if ((email && seenEmails.has(email)) || (phone && seenPhones.has(phone))) {
          duplicateInFile++
          return null
        }
        if (email) seenEmails.add(email)
        if (phone) seenPhones.add(phone)
        return { full_name: full, email, phone, consent_channels: consentFrom(r) }
      })

      // De-dupe against existing household_members (email or phone match).
      const emails = Array.from(seenEmails)
      const phones = Array.from(seenPhones)
      const existingEmails = new Set<string>()
      const existingPhones = new Set<string>()
      if (emails.length > 0) {
        const { data } = await db.from('household_members').select('email').in('email', emails)
        for (const m of data ?? []) if (m.email) existingEmails.add(String(m.email).toLowerCase())
      }
      if (phones.length > 0) {
        const { data } = await db.from('household_members').select('phone').in('phone', phones)
        for (const m of data ?? []) if (m.phone) existingPhones.add(String(m.phone))
      }

      let duplicateExisting = 0
      for (const c of staged) {
        if (!c) continue
        if ((c.email && existingEmails.has(c.email)) || (c.phone && existingPhones.has(c.phone))) {
          duplicateExisting++
          continue
        }
        importable.push(c)
      }

      const noConsent = importable.filter((c) => c.consent_channels.length === 0).length
      const token = randomUUID()
      const summary = {
        counts: {
          total: table.rows.length,
          importable: importable.length,
          duplicateInFile,
          duplicateExisting,
          errors: errors.length,
          noConsent,
          truncated,
        },
        importable,
        errors: errors.slice(0, 50),
        sample: importable.slice(0, 10).map((c) => ({
          full_name: c.full_name,
          email: c.email,
          phone: c.phone,
          consent: c.consent_channels,
        })),
      }

      const { data: job, error } = await db
        .from('import_jobs')
        .insert({
          entity: 'ghl_contacts',
          status: 'preview',
          mapping: { source: 'ghl_csv' },
          summary,
          rollback_token: token,
          row_count: importable.length,
          error_count: errors.length,
          actor,
        })
        .select('id')
        .single()
      if (error || !job) return NextResponse.json({ error: error?.message ?? 'Preview failed' }, { status: 500 })

      return NextResponse.json({
        job_id: job.id,
        token,
        counts: summary.counts,
        sample: summary.sample,
        errors: summary.errors,
      })
    }

    // ── COMMIT ───────────────────────────────────────────────────────────────
    if (mode === 'commit') {
      const jobId = parsed.data.job_id
      if (!jobId) return NextResponse.json({ error: 'job_id required' }, { status: 400 })
      const { data: job } = await db
        .from('import_jobs')
        .select('id, status, summary, rollback_token')
        .eq('id', jobId)
        .maybeSingle()
      if (!job) return NextResponse.json({ error: 'Import job not found' }, { status: 404 })
      if (job.status !== 'preview') return NextResponse.json({ error: `Job already ${job.status}` }, { status: 409 })

      const summary = (job.summary ?? {}) as { importable?: Candidate[] }
      const rows = Array.isArray(summary.importable) ? summary.importable : []
      const createdHouseholds: string[] = []
      let membersCreated = 0
      let consentsCreated = 0

      for (const c of rows) {
        const { data: hh } = await db
          .from('households')
          .insert({ primary_name: c.full_name })
          .select('id')
          .single()
        if (!hh) continue
        createdHouseholds.push(hh.id)
        const { data: mem } = await db
          .from('household_members')
          .insert({ household_id: hh.id, full_name: c.full_name, relationship: 'primary', email: c.email, phone: c.phone })
          .select('id')
          .single()
        if (mem) membersCreated++
        for (const channel of c.consent_channels) {
          const { error: cErr } = await db
            .from('consents')
            .insert({ household_id: hh.id, member_id: mem?.id ?? null, channel, status: 'granted', source: 'ghl_import' })
          if (!cErr) consentsCreated++
        }
      }

      const committedSummary = {
        ...summary,
        created: { households: createdHouseholds, membersCreated, consentsCreated },
      }
      await db
        .from('import_jobs')
        .update({ status: 'committed', summary: committedSummary, updated_at: new Date().toISOString() })
        .eq('id', jobId)

      await writeAudit({
        actor,
        action: 'import.committed',
        entity: 'import_job',
        entityId: jobId,
        diff: { entity: 'ghl_contacts', households: createdHouseholds.length, members: membersCreated, consents: consentsCreated },
      })

      return NextResponse.json({
        ok: true,
        token: job.rollback_token,
        created: { households: createdHouseholds.length, members: membersCreated, consents: consentsCreated },
      })
    }

    // ── ROLLBACK ─────────────────────────────────────────────────────────────
    if (mode === 'rollback') {
      const token = parsed.data.token
      if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })
      const { data: job } = await db
        .from('import_jobs')
        .select('id, status, summary')
        .eq('rollback_token', token)
        .maybeSingle()
      if (!job) return NextResponse.json({ error: 'No import found for that token' }, { status: 404 })
      if (job.status !== 'committed') return NextResponse.json({ error: `Job is ${job.status}` }, { status: 409 })

      const summary = (job.summary ?? {}) as { created?: { households?: string[] } }
      const households = summary.created?.households ?? []
      // Deleting a household cascades its members + consents (FK on delete cascade).
      if (households.length > 0) {
        await db.from('households').delete().in('id', households)
      }
      await db
        .from('import_jobs')
        .update({ status: 'rolledback', updated_at: new Date().toISOString() })
        .eq('id', job.id)

      await writeAudit({
        actor,
        action: 'import.rolledback',
        entity: 'import_job',
        entityId: job.id,
        diff: { households: households.length },
      })
      return NextResponse.json({ ok: true, restored: households.length })
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}
