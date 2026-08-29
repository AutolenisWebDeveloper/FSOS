import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson, escapeHtml } from '@/lib/http'
import { FNA_MODEL } from '@/lib/anthropic'
import { runGateway } from '@/lib/ai/gateway'
import { sendEmail } from '@/lib/messaging'
import { renderEmailShell } from '@/lib/notifications/email-shell'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/briefing/send  (internal)  body: { to? }
// Assembles today's operational snapshot (overdue/today tasks, week's renewals,
// top opportunities), has Claude write a short morning briefing, and emails it
// via Resend. Can be called by a scheduler (Vercel Cron) each morning.
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
    const { text } = await runGateway({
      model: FNA_MODEL,
      maxTokens: 900,
      messages: [{ role: 'user', content: prompt }],
    })
    body = text.trim()
    if (!body) throw new Error('empty briefing')
  } catch (err) {
    console.error('[briefing] AI failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'AI failed to generate the briefing' }, { status: 502 })
  }

  // Rendered through the shared premium email shell so the internal digest matches the
  // rest of the FSOS email system. body is AI text → escaped, then preserved as pre-wrap.
  const contentHtml = `<div style="white-space:pre-wrap;color:#3A4256;font-size:15px;line-height:1.7;">${escapeHtml(body)}</div>
    <p style="margin:18px 0 0;color:#8A94A6;font-size:11px;line-height:1.6;">Generated by FSOS · ${escapeHtml(today)} · counts reflect live data at send time.</p>`
  const html = renderEmailShell({
    preheader: `Your FSOS morning briefing for ${today}`,
    eyebrow: 'Morning Briefing',
    heading: 'Good morning — your FSOS briefing',
    contentHtml,
  })

  // Internal operator digest (not marketing) → transactional, ungated. Send through
  // the shared, guarded sender so the Resend wrapper, reply-to routing, and the
  // never-throw { ok, error } contract match the rest of the app.
  // GATED. This previously reached Resend with raw gateway output and no checks at all.
  // NOTE (surfaced, not fixed here — out of scope by decision): `to` is still
  // caller-supplied via the request body, so an internally-authenticated caller can direct
  // this digest at an arbitrary address. Consolidation gates the SEND; validating the
  // recipient input is a separate defect and is reported, not repaired, in this change.
  const result = await sendEmail(to, `FSOS Morning Briefing — ${today}`, html, body, {
    policy: {
      actor: 'system:briefing',
      purpose: 'TRANSACTIONAL',
      templateKind: 'system_transactional',
      suppressible: false,
      consentWaived: true,
      // Deliberately NOT flagged aiGenerated: the §11/§12 authority matrix governs
      // CLIENT-FACING autonomous AI, and its fail-safe holds an unclassified draft "for the
      // licensed FSA" — which is circular for a digest ADDRESSED to that FSA's own inbox
      // (it would hold every briefing forever). The control that matters for raw gateway
      // output still runs: with no approved human template, the recommendation red line
      // (gate step 5) screens this body at the chokepoint like any other unapproved copy.
    },
  })
  if (!result.ok) {
    console.error('[briefing] send failed:', result.error)
    return NextResponse.json({ error: result.error || 'Email send failed' }, { status: 502 })
  }
  return NextResponse.json({
    success: true,
    to,
    email_id: result.id || null,
    counts: {
      tasks_due: snapshot.tasks_due.length,
      conversion_deadlines: snapshot.conversion_deadlines.length,
      top_opportunities: snapshot.top_opportunities.length,
    },
  })
}
