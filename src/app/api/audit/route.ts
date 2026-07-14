import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, parseLimit } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/audit?limit=120  (internal)
// Unified "who did what" timeline merged from the operational tables: contact
// imports, form sends, consent changes, tasks, logged activity (incl. campaign
// sends), and workshop registrations. Read-only.
const PER_TABLE = 40

interface AuditItem {
  when: string
  kind: string
  actor: string
  summary: string
}

export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const supabase = getDb()
  const limit = parseLimit(new URL(req.url).searchParams.get('limit'), 120, 300)

  const [imports, sends, consent, tasks, activity, regs] = await Promise.all([
    supabase.from('ghl_upload_batches').select('created_at, created_by, filename, total_rows, success_count').order('created_at', { ascending: false }).limit(PER_TABLE),
    supabase.from('form_sends').select('sent_at, form_id, channel, destination').order('sent_at', { ascending: false }).limit(PER_TABLE),
    supabase.from('consent_ledger').select('recorded_at, channel, status, source').order('recorded_at', { ascending: false }).limit(PER_TABLE),
    supabase.from('tasks').select('created_at, created_by, title, source').order('created_at', { ascending: false }).limit(PER_TABLE),
    supabase.from('activity').select('created_at, type, subject, ai_agent, direction').order('created_at', { ascending: false }).limit(PER_TABLE),
    supabase.from('workshop_registrations').select('registered_at, workshops(title)').order('registered_at', { ascending: false }).limit(PER_TABLE),
  ])

  const items: AuditItem[] = []
  for (const r of imports.data || []) {
    if (!r.created_at) continue
    items.push({ when: r.created_at, kind: 'import', actor: r.created_by || 'system', summary: `Imported ${r.success_count ?? 0}/${r.total_rows ?? 0} contacts${r.filename ? ` from ${r.filename}` : ''}` })
  }
  for (const r of sends.data || []) {
    if (!r.sent_at) continue
    items.push({ when: r.sent_at, kind: 'form_send', actor: 'system', summary: `Sent ${r.form_id} via ${r.channel} to ${r.destination}` })
  }
  for (const r of consent.data || []) {
    if (!r.recorded_at) continue
    items.push({ when: r.recorded_at, kind: 'consent', actor: r.source || 'system', summary: `Consent ${r.status} — ${r.channel}` })
  }
  for (const r of tasks.data || []) {
    if (!r.created_at) continue
    items.push({ when: r.created_at, kind: 'task', actor: r.created_by || 'system', summary: `Task created: ${r.title}${r.source && r.source !== 'manual' ? ` (${r.source})` : ''}` })
  }
  for (const r of activity.data || []) {
    if (!r.created_at) continue
    items.push({ when: r.created_at, kind: r.type || 'activity', actor: r.ai_agent || 'agent', summary: `${r.direction ? r.direction + ' ' : ''}${r.type}${r.subject ? `: ${r.subject}` : ''}` })
  }
  for (const r of regs.data || []) {
    if (!r.registered_at) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const title = (r as any).workshops?.title
    items.push({ when: r.registered_at, kind: 'workshop', actor: 'public', summary: `Workshop registration${title ? `: ${title}` : ''}` })
  }

  items.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0))
  return NextResponse.json({ events: items.slice(0, limit) })
}
