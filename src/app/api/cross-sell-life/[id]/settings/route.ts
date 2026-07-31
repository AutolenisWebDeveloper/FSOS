import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { updateSettings, CONTROL_ROLES } from '@/lib/cross-sell-life/controls'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Editable settings (§ Settings). Only permitted on a non-Active, non-Archived version (§16
// immutability) — an Active version must be re-versioned first. Every field is optional; the
// service filters to the editable allow-list and audit-logs the diff.
const SettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000),
    objective: z.string().trim().max(2000),
    daily_enrollment_limit: z.number().int().positive(),
    reenroll_cooldown_days: z.number().int().nonnegative(),
    resume_cooling_off_days: z.number().int().nonnegative(),
    advisor_due_hours: z.number().int().nonnegative(),
    advisor_overdue_escalate_hours: z.number().int().nonnegative(),
    advisor_reassign_after_hours: z.number().int().nonnegative(),
    conversation_timeout_hours: z.number().int().nonnegative(),
    advisor_hold_behavior: z.enum(['proceed', 'hold']),
    intent_confidence_threshold: z.number().min(0).max(1),
    send_on_weekends: z.boolean(),
    send_on_holidays: z.boolean(),
    holiday_calendar: z.array(z.string()),
    resume_behavior: z.enum(['all_active', 'only_admin_paused', 'restart_day_1', 'only_new']),
    replay_policy: z.enum(['skip', 'replay']),
    purpose: z.string().trim().max(200),
    represented_agency_owner_id: z.string().uuid(),
    delegation_id: z.string().uuid(),
  })
  .partial()

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, CONTROL_ROLES)
  if (denied) return denied

  const { id } = await props.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const input = SettingsSchema.safeParse(parsed.data)
  if (!input.success) return NextResponse.json({ error: 'Invalid input', details: input.error.flatten() }, { status: 400 })

  try {
    const result = await updateSettings({ campaignId: id, actor: actorOf(auth.session), patch: input.data })
    if (!result.ok) {
      const status =
        result.error === 'campaign_missing'
          ? 404
          : result.error === 'active_immutable' || result.error === 'archived_readonly'
            ? 409
            : 400
      return NextResponse.json(result, { status })
    }
    return NextResponse.json(result)
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Settings update failed' }, { status: 500 })
  }
}
