import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, escapeHtml } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { getCurrentUserEmail } from '@/lib/auth/session'
import { dispatch } from '@/lib/comms/dispatcher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// "Email me this briefing" (docs/legacy-port.md §2.10). Merges the legacy
// api/briefing/send into the FSOS briefing: it assembles today's priorities from
// live signals and sends the FSA their own digest — but the send routes through
// the comms dispatcher's 7-step gate (lib/comms/dispatcher.ts) like every other
// automated send, not raw Resend. A gate block is logged + escalated, never a
// silent send. No product recommendations; no securities data.

/** Current hour (0–23) in the configured operator timezone (TX). */
function operatorLocalHour(): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hourCycle: 'h23',
    hour: '2-digit',
  }).format(new Date())
  const h = Number.parseInt(s, 10)
  return Number.isFinite(h) ? h % 24 : 12
}

export async function POST(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const to = await getCurrentUserEmail()
  if (!to) {
    return NextResponse.json({ error: 'No email on file for your account.' }, { status: 422 })
  }

  const actor = actorOf(auth.session)

  try {
    const db = getDb()
    // Same live signals as the briefing dashboard — never a product recommendation.
    const [slaEsc, dueConv, discrepancies, escalations] = await Promise.all([
      db.from('v_referrals_awaiting_action').select('id').eq('sla_breached', true).limit(500),
      db.from('v_conversions_due').select('policy_id').eq('urgency_tier', '30').eq('is_security', false).limit(500),
      db.from('commissions').select('id').eq('reconciliation_status', 'discrepancy').limit(500),
      db.from('agent_actions').select('id').eq('kind', 'escalation').eq('outcome', 'escalated').limit(500),
    ])

    const priorities = [
      { label: 'SLA-breached referrals', count: slaEsc.data?.length ?? 0 },
      { label: 'Conversion windows ≤30d', count: dueConv.data?.length ?? 0 },
      { label: 'Commission discrepancies', count: discrepancies.data?.length ?? 0 },
      { label: 'Open AI escalations', count: escalations.data?.length ?? 0 },
    ]

    const rows = priorities
      .map((p) => `<li><strong>${p.count}</strong> ${escapeHtml(p.label)}</li>`)
      .join('')
    const body = `
      <div style="font-family:system-ui,sans-serif;color:#1a2332">
        <h2 style="margin:0 0 8px">Your FSOS Daily Briefing</h2>
        <p style="color:#4a5568;margin:0 0 12px">Today's priorities, surfaced from live signals. For educational and operational purposes only — not a product recommendation.</p>
        <ul style="line-height:1.7">${rows}</ul>
        <p style="color:#718096;font-size:12px;margin-top:16px">Open FSOS to act on these: /app/executive/briefing</p>
      </div>`.trim()

    // Route through the dispatcher gate. This is an operator's own approved internal
    // digest: consent by nature, approved template, no securities, no recommendation.
    // Quiet hours + DNC are still evaluated honestly (a block escalates, never sends).
    const result = await dispatch({
      channel: 'email',
      to,
      subject: 'Your FSOS Daily Briefing',
      body,
      actor,
      entity: { type: 'briefing', id: auth.session.userId },
      escalationNote: 'Self-directed daily briefing email blocked by the comms gate.',
      gate: {
        hasConsent: true,
        recipientLocalHour: operatorLocalHour(),
        onDNC: false,
        usesApprovedTemplateOrPolicy: true,
        isSecurity: false,
      },
    })

    if (!result.sent) {
      return NextResponse.json(
        { sent: false, blocked: true, reason: result.gate.reason, step: result.gate.blockedStep },
        { status: 200 },
      )
    }
    return NextResponse.json({ sent: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to send briefing' }, { status: 500 })
  }
}
