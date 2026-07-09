import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson, parseLimit, callerLabel } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// /api/tasks  (internal) — follow-up tasks for the Follow-Ups screen.
//   GET   ?status=open&due=today|overdue|week|all&customer_id=&limit=
//   POST  { title, notes?, customer_id?, agency_id?, due_date?, priority?, source? }
//   PATCH { task_id, status?|due_date?|priority?|title?|notes? }  (marks completed_at on done)

const PRIORITIES = ['low', 'medium', 'high'] as const
const STATUSES = ['open', 'done', 'snoozed'] as const

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(2000).optional(),
  customer_id: z.string().uuid().optional(),
  agency_id: z.string().max(64).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(PRIORITIES).optional(),
  source: z.enum(['manual', 'ai', 'auto', 'renewal']).optional(),
})

const PatchSchema = z.object({
  task_id: z.string().uuid(),
  status: z.enum(STATUSES).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  notes: z.string().max(2000).nullable().optional(),
})

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function addDaysISO(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const supabase = getDb()
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || 'open'
  const due = url.searchParams.get('due') || 'all'
  const customerId = url.searchParams.get('customer_id')
  const limit = parseLimit(url.searchParams.get('limit'), 200, 500)

  let q = supabase
    .from('tasks')
    .select('*, customers(first_name, last_name)')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status !== 'all') q = q.eq('status', status)
  if (customerId) q = q.eq('customer_id', customerId)
  if (due === 'today') q = q.eq('due_date', todayISO())
  else if (due === 'overdue') q = q.lt('due_date', todayISO())
  else if (due === 'week') q = q.lte('due_date', addDaysISO(7)).gte('due_date', todayISO())

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tasks: data || [] })
}

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CreateSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid task', details: v.error.flatten() }, { status: 400 })
  }

  const supabase = getDb()
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...v.data, created_by: callerLabel(req) })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PatchSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  }

  const { task_id, ...fields } = v.data
  const update: Record<string, unknown> = { ...fields }
  // Stamp / clear the completion time when the status flips.
  if (fields.status === 'done') update.completed_at = new Date().toISOString()
  else if (fields.status) update.completed_at = null

  const supabase = getDb()
  const { data, error } = await supabase.from('tasks').update(update).eq('task_id', task_id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  return NextResponse.json({ task: data })
}
