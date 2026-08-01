import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'
import { z } from 'zod'
import { personalize, type RecipientContext } from '@/lib/comms/personalize'
import { resolveAssetPayload } from '@/lib/comms/assets'
import { smsSegmentInfo } from '@/lib/comms/console'
import { TRAIGA_SMS_FOOTER } from '@/lib/compliance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Communications Command Console (spec §4 preview / §5 preview pane) — production render of
// a chosen asset or blank body for a chosen recipient. READ-ONLY and dispatch-INCAPABLE:
// it never calls the gate, never writes comm_messages, never advances any state. It uses
// the SAME personalize() the send path uses, so what the operator previews is what will
// send. Guarantees no raw {{token}} / undefined / null leaks (personalize falls back to safe
// neutral values). SMS also returns the encoding + segment estimate; email returns the HTML
// + plaintext parts; AI returns the seeded opening turn.
const PreviewSchema = z.object({
  channel: z.enum(['sms', 'email']),
  source_kind: z.enum(['blank', 'campaign_asset', 'agent_seed']).default('blank'),
  body: z.string().max(8000).optional(),
  subject: z.string().max(200).optional(),
  source_asset_id: z.string().uuid().optional(),
  source_asset_table: z.string().max(80).optional(),
  recipient: z
    .object({
      first_name: z.string().max(120).optional(),
      last_name: z.string().max(120).optional(),
      full_name: z.string().max(240).optional(),
      city: z.string().max(120).optional(),
      agency_name: z.string().max(240).optional(),
      fsa_name: z.string().max(240).optional(),
    })
    .optional(),
})

const EMAIL_FOOTER_NOTE =
  'The per-recipient unsubscribe link and open/click tracking are injected at send time; this preview shows the composed body.'

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PreviewSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid preview request', details: v.error.flatten() }, { status: 400 })
  const d = v.data

  try {
    let body = d.body ?? ''
    let subject = d.subject ?? null
    let bodyText: string | null = null

    if (d.source_kind === 'campaign_asset') {
      if (!d.source_asset_id || !d.source_asset_table) {
        return NextResponse.json({ error: 'An asset is required for a campaign preview.', reason: 'no_asset' }, { status: 400 })
      }
      const asset = await resolveAssetPayload(d.source_asset_id, d.source_asset_table)
      if (!asset) return NextResponse.json({ error: 'Selected asset could not be resolved.', reason: 'asset_not_found' }, { status: 404 })
      body = asset.body
      subject = asset.subject ?? subject
      bodyText = asset.bodyText
    }
    if (!body.trim()) return NextResponse.json({ error: 'Nothing to preview yet.', reason: 'empty' }, { status: 400 })

    const ctx: RecipientContext = d.recipient ?? {}
    // Email HTML escapes merge values exactly as the send path does (stored-XSS parity).
    const renderedBody = personalize(body, ctx, { escapeHtml: d.channel === 'email' })
    const renderedText = bodyText ? personalize(bodyText, ctx) : null
    const renderedSubject = subject ? personalize(subject, ctx) : null

    if (d.channel === 'sms') {
      // The dispatcher appends the TRAIGA/STOP footer to every SMS at send time — show it.
      const finalBody = `${renderedBody}\n\n${TRAIGA_SMS_FOOTER}`
      return NextResponse.json({
        channel: 'sms',
        source_kind: d.source_kind,
        body: finalBody,
        segment: smsSegmentInfo(finalBody),
        note: 'The STOP/HELP + AI-disclosure footer shown here is appended automatically at send.',
      })
    }

    if (d.source_kind === 'agent_seed') {
      return NextResponse.json({
        channel: 'sms',
        source_kind: 'agent_seed',
        opening_turn: renderedBody,
        note: 'This is the seeded opening turn. The AI conversation is initiated (and armed) only after it clears the gate on send.',
      })
    }

    return NextResponse.json({
      channel: 'email',
      source_kind: d.source_kind,
      subject: renderedSubject,
      html: renderedBody,
      text: renderedText,
      note: EMAIL_FOOTER_NOTE,
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to render preview' }, { status: 500 })
  }
}
