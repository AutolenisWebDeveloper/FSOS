// scripts/build-sms-templates.ts
// P5 Stage 4 — upsert the booking lifecycle SMS templates (src/lib/booking/sms-templates.ts)
// as DRAFT comm_templates (plain-text body + content hash + source_key, channel 'sms'). The SMS
// counterpart to build-email-templates.ts; author-time / ops tool, run with
// `npm run templates:build:sms`. NEVER runs in the send path.
//
// Immutable-approval model (identical to the email build): same body bytes → no-op; changed
// bytes (new hash) → bump version + reset approval_status to 'draft' (cleared approved_at/by) so
// the new wording is re-reviewed; new source_key → insert as version 1 draft. Nothing sends until
// the FSA approves each row (gate step 4) AND SMS_A2P_APPROVED=true (A2P go-live).
//
// Env: NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL  and  SUPABASE_SERVICE_KEY | SUPABASE_SERVICE_ROLE_KEY
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { BOOKING_SMS_TEMPLATES } from '../src/lib/booking/sms-templates'

// Minimal .env loader (never logs values), mirroring the other ops scripts.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* .env.local optional — env may already be set */
}

/** Content hash of the exact SMS body (the immutable-approval key, like the email render_sha). */
function bodyHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase env not set (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY).')
  }
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  let created = 0
  let updated = 0
  let unchanged = 0
  for (const tpl of BOOKING_SMS_TEMPLATES) {
    const sha = bodyHash(tpl.body)
    const { data: existing, error: selectError } = await db
      .from('comm_templates')
      .select('id, version, render_sha')
      .eq('source_key', tpl.sourceKey)
      .is('archived_at', null)
      .maybeSingle()
    // Never treat a failed lookup as "not found" — that would INSERT a duplicate on a transient
    // read error. Abort loudly so the run can be retried.
    if (selectError) throw new Error(`Lookup failed for ${tpl.sourceKey}: ${selectError.message}`)

    if (!existing) {
      const { error } = await db.from('comm_templates').insert({
        name: tpl.name, channel: 'sms', category: tpl.category,
        body: tpl.body, render_sha: sha, source_key: tpl.sourceKey,
        approval_status: 'draft', version: 1, updated_by: 'script:build-sms-templates',
      })
      if (error) throw error
      created++
      console.log(`+ created  ${tpl.sourceKey} (v1, draft)`)
    } else if (existing.render_sha === sha) {
      unchanged++
      console.log(`= unchanged ${tpl.sourceKey} (body hash match)`)
    } else {
      const { error } = await db.from('comm_templates').update({
        name: tpl.name, category: tpl.category,
        body: tpl.body, render_sha: sha,
        version: (existing.version ?? 1) + 1,
        approval_status: 'draft', approved_at: null, approved_by: null,
        updated_by: 'script:build-sms-templates',
      }).eq('id', existing.id)
      if (error) throw error
      updated++
      console.log(`~ updated  ${tpl.sourceKey} (v${(existing.version ?? 1) + 1}, reset to draft — needs re-approval)`)
    }
  }
  console.log(`\nDone: ${created} created, ${updated} updated (re-approval needed), ${unchanged} unchanged.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
