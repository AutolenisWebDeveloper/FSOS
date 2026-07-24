// scripts/build-email-templates.ts
// Slice 9B (ADR-025) — render the React Email templates and upsert them as DRAFT
// comm_templates (stored HTML + plaintext + render_sha + source_key). Author-time / ops
// tool; run with `npm run templates:build`. NEVER runs in the send path.
//
// Immutable-approval model, preserved:
//   • A source_key with the SAME render_sha already stored → no-op (idempotent).
//   • Changed bytes (new render_sha) → bump version + reset approval_status to 'draft'
//     (approved_at/approved_by cleared) so the exact new bytes are re-reviewed.
//   • New source_key → insert as version 1 draft.
//
// Env: NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL  and  SUPABASE_SERVICE_KEY | SUPABASE_SERVICE_ROLE_KEY
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { EMAIL_TEMPLATES } from '../src/emails/registry'
import { renderEmailTemplate } from '../src/emails/render'

// Minimal .env loader (never logs values), mirroring the other ops scripts.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* .env.local optional — env may already be set */
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
  for (const tpl of EMAIL_TEMPLATES) {
    const { html, text, sha } = await renderEmailTemplate(tpl.element)
    const { data: existing, error: selectError } = await db
      .from('comm_templates')
      .select('id, version, render_sha')
      .eq('source_key', tpl.sourceKey)
      .is('archived_at', null)
      .maybeSingle()
    // Never treat a failed lookup as "not found" — that would INSERT a duplicate of an
    // existing template on a transient read error. Abort loudly so the run can be retried.
    if (selectError) throw new Error(`Lookup failed for ${tpl.sourceKey}: ${selectError.message}`)

    if (!existing) {
      const { error } = await db.from('comm_templates').insert({
        name: tpl.name, channel: tpl.channel, category: tpl.category,
        body: html, body_text: text, render_sha: sha, source_key: tpl.sourceKey,
        approval_status: 'draft', version: 1, updated_by: 'script:build-email-templates',
      })
      if (error) throw error
      created++
      console.log(`+ created  ${tpl.sourceKey} (v1, draft)`)
    } else if (existing.render_sha === sha) {
      unchanged++
      console.log(`= unchanged ${tpl.sourceKey} (render_sha match)`)
    } else {
      const { error } = await db.from('comm_templates').update({
        name: tpl.name, category: tpl.category,
        body: html, body_text: text, render_sha: sha,
        version: (existing.version ?? 1) + 1,
        approval_status: 'draft', approved_at: null, approved_by: null,
        updated_by: 'script:build-email-templates',
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
