import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { runBulkTagConsent } from '@/lib/comms/bulk-consent-run'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Bulk "Group Consents" (Compliance → Consent, §12/TCPA). Grant or revoke consent for every
// contact in one or more tag-defined groups, in one operation.
//
//   dry_run: true  → PREVIEW. Resolve the population + plan the write, change nothing. No
//                    attestation/confirmation required — used to show the operator the exact
//                    counts before they commit.
//   dry_run: false → COMMIT.
//       action 'grant'  → requires `attest` true: a legal assertion the contacts already gave
//                         prior express consent. Grant is suppression-aware — opt-outs are never
//                         re-consented (skipped + reported).
//       action 'revoke' → requires `confirm` true. Revoke applies to every group member.
//
// Thin handler: authorize → validate → delegate → shape the report (§3.1).

const BulkGroupSchema = z
  .object({
    tags: z.array(z.string().trim().min(1)).min(1).max(50),
    channels: z.array(z.enum(['sms', 'email'])).min(1),
    action: z.enum(['grant', 'revoke']),
    dry_run: z.boolean().optional(),
    // Required (true) to COMMIT a grant — the prior-express-consent attestation.
    attest: z.boolean().optional(),
    // Required (true) to COMMIT a revoke — the apply confirmation.
    confirm: z.boolean().optional(),
  })
  .strict()

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = BulkGroupSchema.safeParse(parsed.data ?? {})
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  const { tags, channels, action, dry_run: dryRun, attest, confirm } = v.data

  if (dryRun !== true) {
    if (action === 'grant' && attest !== true) {
      return NextResponse.json(
        {
          error:
            'To grant consent to this group you must confirm these contacts have already provided prior express consent for the selected channels.',
          reason: 'consent_attestation_required',
        },
        { status: 422 },
      )
    }
    if (action === 'revoke' && confirm !== true) {
      return NextResponse.json(
        { error: 'Please confirm the bulk revoke before applying.', reason: 'confirmation_required' },
        { status: 422 },
      )
    }
  }

  try {
    const report = await runBulkTagConsent({
      tags,
      channels,
      action,
      actor: actorOf(auth.session),
      dryRun: dryRun === true,
    })
    return NextResponse.json({ ok: true, dryRun: dryRun === true, report })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to run bulk consent update' }, { status: 500 })
  }
}
