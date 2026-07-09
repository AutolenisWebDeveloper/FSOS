import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson, escapeHtml } from '@/lib/http'
import { getAnthropic, FNA_MODEL } from '@/lib/anthropic'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/briefing/send  (internal)  body: { to? }
// Assembles today's operational snapshot (overdue/today tasks, week's renewals,
// top opportunities), has Claude write a short morning briefing, and emails it
// via Resend. Can be called by a scheduler (Make.com / cron) each morning.
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function addDaysISO(n: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI not configured (ANTHROPIC_API_KEY).', code: 'not_configured' }, { status: 503 })
  }
  if (!apiKey) return NextResponse.json({ error: 'RESEND_API_KEY is not set.' }, { status: 503 })
  if (!from || /yourdomain\.com/i.test(from)) {
    return NextResponse.json({ error: 'RESEND_FROM_EMAIL is not a verified sender.' }, { status: 503 })
  }

  const parsed = await readJson<{ to?: string }>(req)
  if ('error' in parsed) return parsed.error
  const to = (parsed.data.to || process.env.BRIEFING_TO_EMAIL || from).trim()

  const supabase = getDb()
  const today = todayISO()
  const weekOut = addDaysISO(7)

  const [tasksRes, policiesRes, oppsRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('title, due_date, priority, customers(first_name, last_name)')
      .eq('status', 'open')
      .lte('due_date', today)
      .order('due_date', { ascending: true })
      .limit(20),
    supabase
      .from('policies')
      .select('policy_type, carrier, conversion_deadline, customers(first_name, last_name)')
      .eq('status', 'active')
      .not('conversion_deadline', 'is', null)
      .gte('conversion_deadline', today)
      .lte('conversion_deadline', weekOut)
      .order('conversion_deadline', { ascending: true })
      .limit(20),
    supabase
      .from('scores')
      .select('priority_score, primary_pipeline, customers(first_name, last_name)')
      .order('priority_score', { ascending: false })
      .limit(5),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nm = (c: any) => (c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : 'Client')
  const snapshot = {
    date: today,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tasks_due: (tasksRes.data || []).map((t: any) => ({ title: t.title, due: t.due_date, priority: t.priority, client: nm(t.customers) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conversion_deadlines: (policiesRes.data || []).map((p: any) => ({ client: nm(p.customers), deadline: p.conversion_deadline, product: `${p.policy_type || ''} ${p.carrier || ''}`.trim() })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    top_opportunities: (oppsRes.data || []).map((s: any) => ({ client: nm(s.customers), priority: s.priority_score, pipeline: s.primary_pipeline })),
  }

  const prompt = [
    'Write a concise, upbeat morning briefing email for a Farmers Financial Services agent.',
    'Use the snapshot below. Lead with a one-line summary, then short sections for: Tasks due today/overdue, Term-conversion deadlines this week, and Top opportunities.',
    'Be specific with names and dates. Keep it under 200 words. Education-only tone; no product/return guarantees.',
    'Return PLAIN TEXT only (no markdown symbols, no JSON).',
    '',
    'Snapshot (JSON):',
    JSON.stringify(snapshot, null, 2),
  ].join('\n')

  let body: string
  try {
    const client = getAnthropic()
    const res = await client.messages.create({
      model: FNA_MODEL,
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    })
    body = res.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (!body) throw new Error('empty briefing')
  } catch (err) {
    console.error('[briefing] AI failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'AI failed to generate the briefing' }, { status: 502 })
  }

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a2332">
    <h2 style="color:#0f1e36;margin:0 0 12px">Good morning — your FSOS briefing</h2>
    <div style="white-space:pre-wrap">${escapeHtml(body)}</div>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0"/>
    <div style="font-size:11px;color:#6b7a8d">Generated by FSOS · ${escapeHtml(today)} · counts reflect live data at send time.</div>
  </div>`

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: `FSOS Morning Briefing — ${today}`,
      html,
      text: body,
    })
    if (error) {
      console.error('[briefing] Resend rejected:', error)
      return NextResponse.json({ error: error.message || 'Email send failed' }, { status: 502 })
    }
    return NextResponse.json({
      success: true,
      to,
      email_id: data?.id || null,
      counts: {
        tasks_due: snapshot.tasks_due.length,
        conversion_deadlines: snapshot.conversion_deadlines.length,
        top_opportunities: snapshot.top_opportunities.length,
      },
    })
  } catch (err) {
    console.error('[briefing] send exception:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Email send failed' }, { status: 502 })
  }
}
