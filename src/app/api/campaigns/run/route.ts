import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson, escapeHtml } from '@/lib/http'
import { sendEmail, sendSms } from '@/lib/messaging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/campaigns/run  (internal)  body: { campaign_id?, limit? }
// Processes due enrollments (next_send_at <= now, status active): sends the
// current step via the campaign's channel (consent-respecting), then advances
// the enrollment or completes it. Call from a scheduler (cron / Make) or the UI.
const Schema = z.object({
  campaign_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

function fill(tpl: string, c: { first_name?: string; last_name?: string }): string {
  return (tpl || '')
    .replace(/\{first_name\}/gi, c.first_name || 'there')
    .replace(/\{last_name\}/gi, c.last_name || '')
    .trim()
}
function addDays(base: Date, days: number): string {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = Schema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  const supabase = getDb()
  const nowISO = new Date().toISOString()
  const limit = v.data.limit || 100

  let q = supabase
    .from('campaign_enrollments')
    .select('*, campaigns(campaign_id, channel, status, steps), customers(first_name, last_name, email, phone, cell_phone, consent_email, consent_sms)')
    .eq('status', 'active')
    .lte('next_send_at', nowISO)
    .order('next_send_at', { ascending: true })
    .limit(limit)
  if (v.data.campaign_id) q = q.eq('campaign_id', v.data.campaign_id)

  const { data: due, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const counts = { processed: 0, sent: 0, skipped: 0, failed: 0, completed: 0 }

  for (const e of due || []) {
    counts.processed++
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const campaign = (e as any).campaigns
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cust = (e as any).customers
    if (!campaign || campaign.status !== 'active' || !cust) {
      counts.skipped++
      continue
    }

    const steps: Array<{ order: number; delay_days: number; subject?: string; body: string }> = Array.isArray(campaign.steps)
      ? [...campaign.steps].sort((a, b) => a.order - b.order)
      : []
    const step = steps[e.current_step]

    // No more steps → complete the enrollment.
    if (!step) {
      await supabase.from('campaign_enrollments').update({ status: 'completed', completed_at: nowISO }).eq('enrollment_id', e.enrollment_id)
      counts.completed++
      continue
    }

    // Attempt the send, respecting consent + available contact channel.
    let result: { ok: boolean; error?: string; skipped?: boolean }
    if (campaign.channel === 'email') {
      if (!cust.email || !cust.consent_email) result = { ok: false, skipped: true }
      else {
        const body = fill(step.body, cust)
        result = await sendEmail(
          cust.email,
          fill(step.subject || 'A note from your Farmers agent', cust),
          `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(body)}</div>`,
          body,
        )
      }
    } else {
      const to = cust.phone || cust.cell_phone
      if (!to || !cust.consent_sms) result = { ok: false, skipped: true }
      else result = await sendSms(to, fill(step.body, cust))
    }

    // Provider error (not a consent skip) → retry tomorrow, don't advance.
    if (!result.ok && !result.skipped) {
      counts.failed++
      await supabase.from('campaign_enrollments').update({ next_send_at: addDays(new Date(), 1) }).eq('enrollment_id', e.enrollment_id)
      continue
    }

    if (result.ok) {
      counts.sent++
      await supabase.from('activity').insert({
        customer_id: e.customer_id,
        type: campaign.channel,
        direction: 'outbound',
        channel: campaign.channel,
        subject: `Campaign: ${campaign.channel === 'email' ? fill(step.subject || '', cust) : 'SMS step ' + (e.current_step + 1)}`,
        ai_agent: 'drip_campaign',
      })
    } else {
      counts.skipped++ // no consent / no contact — advance anyway
    }

    // Advance to the next step (or complete).
    const nextIdx = e.current_step + 1
    const nextStep = steps[nextIdx]
    if (nextStep) {
      await supabase
        .from('campaign_enrollments')
        .update({ current_step: nextIdx, last_sent_at: result.ok ? nowISO : e.last_sent_at, next_send_at: addDays(new Date(), nextStep.delay_days) })
        .eq('enrollment_id', e.enrollment_id)
    } else {
      await supabase
        .from('campaign_enrollments')
        .update({ current_step: nextIdx, last_sent_at: result.ok ? nowISO : e.last_sent_at, status: 'completed', completed_at: nowISO })
        .eq('enrollment_id', e.enrollment_id)
      counts.completed++
    }
  }

  return NextResponse.json({ ran_at: nowISO, counts })
}
