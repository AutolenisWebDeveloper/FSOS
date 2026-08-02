import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { resolveConsentGroup, selectableChannels, isConsentGroupKey } from '@/lib/comms/consent-groups'
import { backfillGroupConsent } from '@/lib/comms/consent-group-backfill-run'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Retroactive consent-group backfill (§12/TCPA). Seeds the member-keyed `consents` rows for
// contacts ALREADY imported into a group when consent was never seeded at import time — the
// counterpart to the import-time grant, for the existing book.
//
//   dry_run: true  → PREVIEW. Resolves the population + plans the grant, writes nothing. No
//                    attestation required (it changes nothing) — used to show the operator the
//                    exact count before they commit.
//   dry_run: false → COMMIT. Requires an explicit attestation that these contacts have already
//                    provided prior express consent (a legal assertion the licensed operator
//                    owns, mirrored from the importer). Suppression (a later opt-out) is still
//                    enforced downstream, so a grant can never re-consent someone who opted out.
//
// Thin handler: authorize → validate → delegate to the service → shape the report (§3.1).

const BackfillGroupSchema = z
  .object({
    group: z.string().min(1),
    // Channels to seed; intersected with the group's permitted channels. Omit = the group's full set.
    channels: z.array(z.enum(['sms', 'email'])).optional(),
    dry_run: z.boolean().optional(),
    // Required true to COMMIT (ignored for a dry-run preview).
    attest: z.boolean().optional(),
  })
  .strict()

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = BackfillGroupSchema.safeParse(parsed.data ?? {})
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  const { group: groupKeyRaw, channels: channelsRaw, dry_run: dryRun, attest } = v.data

  if (!isConsentGroupKey(groupKeyRaw)) {
    return NextResponse.json({ error: 'Unknown consent group.', reason: 'bad_consent_group' }, { status: 422 })
  }
  const group = resolveConsentGroup(groupKeyRaw)!
  const channels = selectableChannels(group, channelsRaw)
  if (channels.length === 0) {
    return NextResponse.json({ error: 'Select at least one channel (SMS or email).', reason: 'no_consent_channel' }, { status: 422 })
  }

  // Commit requires the attestation; preview never writes so it doesn't.
  if (dryRun !== true && attest !== true) {
    return NextResponse.json(
      {
        error:
          'To grant consent to this group you must confirm these contacts have already provided prior express consent for the selected channels.',
        reason: 'consent_attestation_required',
      },
      { status: 422 },
    )
  }

  try {
    const report = await backfillGroupConsent({
      group,
      channels,
      actor: actorOf(auth.session),
      dryRun: dryRun === true,
    })
    return NextResponse.json({ ok: true, dryRun: dryRun === true, report })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to run consent backfill' }, { status: 500 })
  }
}
