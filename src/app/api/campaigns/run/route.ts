import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson } from '@/lib/http'
import { sendThroughGate } from '@/lib/comms/send'
import { buildCampaignSend } from '@/lib/comms/campaign-run'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/campaigns/run  (internal)  body: { campaign_id?, limit? }
// Processes due enrollments (next_send_at <= now, status active): sends the current
// step through the FULL compliance gate (sendThroughGate — consent, quiet-hours, DNC,
// approved-template, recommendation, is_security), then advances or completes the
// enrollment. There is NO raw send path: this route no longer calls sendEmail/sendSms
// directly (C-1). The dispatcher appends the required TRAIGA/Reply-STOP SMS footer.
const Schema = z.object({
  campaign_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

function addDays(base: Date, days: number): string {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

// A gate block on a hard compliance reason (no consent, DNC, securities firewall,
// recommendation language, or unapproved content) is terminal for the enrollment —
// stop it (visible, escalated) rather than silently advancing past the content or
// re-blocking forever. A deferral (quiet-hours / business-hours) is retried later.
const HARD_BLOCKS = new Set(['consent', 'dnc', 'is_security', 'recommendation', 'approved_template'])

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
    .select('*, campaigns(campaign_id, channel, status, steps, template_id), customers(first_name, last_name, email, phone, cell_phone, consent_email, consent_sms, is_security)')
    .eq('status', 'active')
    .lte('next_send_at', nowISO)
    .order('next_send_at', { ascending: true })
    .limit(limit)
  if (v.data.campaign_id) q = q.eq('campaign_id', v.data.campaign_id)

  const { data: due, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const counts = { processed: 0, sent: 0, skipped: 0, blocked: 0, deferred: 0, failed: 0, completed: 0 }

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

    // Derive the row-level send context; skip if there is no contact method.
    const cs = buildCampaignSend(campaign, cust, step)
    if (!cs) {
      counts.skipped++
      // No usable channel — advance so the enrollment isn't stuck on this step forever.
      const nextIdx = e.current_step + 1
      const done = !steps[nextIdx]
      await supabase.from('campaign_enrollments').update({
        current_step: nextIdx,
        ...(done ? { status: 'completed', completed_at: nowISO } : { next_send_at: addDays(new Date(), steps[nextIdx].delay_days) }),
      }).eq('enrollment_id', e.enrollment_id)
      if (done) counts.completed++
      continue
    }

    // Send through the full 7-step gate (consent/quiet-hours/DNC/template/recommendation/securities).
    const outcome = await sendThroughGate({
      channel: cs.channel,
      to: cs.to,
      subject: cs.subject,
      body: cs.body,
      actor: 'campaign:drip',
      durableConsentGranted: cs.durableConsentGranted,
      isSecurity: cs.isSecurity,
      templateId: cs.templateId,
      campaignId: campaign.campaign_id,
      sequenceStep: e.current_step,
      entity: { type: 'customer', id: e.customer_id },
    })

    if (!outcome.sent) {
      const step_ = outcome.gate?.blockedStep ?? null
      if (step_ && HARD_BLOCKS.has(step_)) {
        // Terminal compliance block (already escalated by the dispatcher) — stop the
        // enrollment instead of silently advancing or re-blocking daily.
        counts.blocked++
        await supabase.from('campaign_enrollments').update({ status: 'stopped', completed_at: nowISO }).eq('enrollment_id', e.enrollment_id)
      } else {
        // Deferral (quiet-hours / business-hours) or provider error → retry tomorrow.
        counts.deferred++
        await supabase.from('campaign_enrollments').update({ next_send_at: addDays(new Date(), 1) }).eq('enrollment_id', e.enrollment_id)
      }
      continue
    }

    counts.sent++

    // Advance to the next step (or complete).
    const nextIdx = e.current_step + 1
    const nextStep = steps[nextIdx]
    if (nextStep) {
      await supabase
        .from('campaign_enrollments')
        .update({ current_step: nextIdx, last_sent_at: nowISO, next_send_at: addDays(new Date(), nextStep.delay_days) })
        .eq('enrollment_id', e.enrollment_id)
    } else {
      await supabase
        .from('campaign_enrollments')
        .update({ current_step: nextIdx, last_sent_at: nowISO, status: 'completed', completed_at: nowISO })
        .eq('enrollment_id', e.enrollment_id)
      counts.completed++
    }
  }

  return NextResponse.json({ ran_at: nowISO, counts })
}
