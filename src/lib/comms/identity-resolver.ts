// src/lib/comms/identity-resolver.ts
// Slice 2 — First-contact identity disclosure (DB-backed resolver).
//
// Bridges the pure engine (identity.ts) to the live conversation state + the approved,
// editable disclosure config (comm_identity_config). send.ts calls this before dispatch;
// when a FULL introduction is required (§8) AND an APPROVED config exists, it returns the
// rendered disclosure for the platform to auto-prepend — the campaign author never
// inserts it. It never fabricates the Farmers wording (§4.3): the wording comes from the
// approved config, and if no approved config exists nothing is auto-disclosed (the need
// is recorded for follow-up instead of guessing the wording).

import { getDb } from '@/lib/supabase/client'
import {
  evaluateIdentityDisclosure,
  renderIdentityDisclosure,
  type Channel,
  type IdentityVars,
} from './identity'

export interface IdentityContext {
  /** The actual sender (for sender-change detection + rendering). */
  senderUserId?: string | null
  /** The communication purpose (for purpose-change detection + the disclosure reason). */
  purpose?: string | null
  /** Caller signals this is the first message of a new campaign. */
  newCampaign?: boolean
  /** Caller signals an agency-owner/contact-owner reassignment since last disclosure. */
  reassignment?: boolean
  /** Caller signals the contact explicitly asked who is contacting them. */
  contactAskedWhoIsThis?: boolean
  /** Names for rendering the disclosure (actual sender + represented agency owner). */
  vars: IdentityVars
}

export interface IdentityResult {
  fullIntro: boolean
  isFirstChannelTouch: boolean
  /** Rendered full disclosure to prepend, or null (abbreviated/established or no config). */
  disclosure: string | null
  version: number | null
  reason: string
  configApproved: boolean
}

interface ConversationIdentityState {
  identity_disclosed_at: string | null
  identity_disclosure_version: number | null
  identity_sender_user_id: string | null
  identity_purpose: string | null
}

interface IdentityConfigRow {
  approval_status: string
  version: number
  inactivity_days: number
  fsa_role_label: string
  full_template: string
  abbreviated_template: string
}

/**
 * Resolve whether this send needs a full identity introduction and, if so and an approved
 * config exists, the rendered disclosure. Fails SAFE toward MORE disclosure (a lookup
 * failure or missing conversation state is treated as "never disclosed" → full intro).
 */
export async function resolveIdentityDisclosure(params: {
  channel: Channel
  conversationId: string | null
  ctx: IdentityContext
}): Promise<IdentityResult> {
  let conv: ConversationIdentityState | null = null
  let cfg: IdentityConfigRow | null = null
  try {
    const db = getDb()
    const [convRes, cfgRes] = await Promise.all([
      params.conversationId
        ? db
            .from('comm_conversations')
            .select('identity_disclosed_at, identity_disclosure_version, identity_sender_user_id, identity_purpose')
            .eq('id', params.conversationId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db
        .from('comm_identity_config')
        .select('approval_status, version, inactivity_days, fsa_role_label, full_template, abbreviated_template')
        .eq('id', 'global')
        .maybeSingle(),
    ])
    conv = (convRes.data as ConversationIdentityState | null) ?? null
    cfg = (cfgRes.data as IdentityConfigRow | null) ?? null
  } catch {
    // Fail safe toward disclosure: no state known → treat as first touch below.
    conv = null
    cfg = null
  }

  const approved = cfg?.approval_status === 'approved'
  const decision = evaluateIdentityDisclosure({
    channel: params.channel,
    priorDisclosedAt: conv?.identity_disclosed_at ?? null,
    now: new Date().toISOString(),
    inactivityDays: cfg?.inactivity_days ?? 45,
    channelAlreadyTouched: !!conv?.identity_disclosed_at,
    newCampaign: params.ctx.newCampaign === true,
    purposeChanged: !!(conv?.identity_purpose && params.ctx.purpose && conv.identity_purpose !== params.ctx.purpose),
    senderChanged: !!(
      conv?.identity_sender_user_id &&
      params.ctx.senderUserId &&
      conv.identity_sender_user_id !== params.ctx.senderUserId
    ),
    reassignment: params.ctx.reassignment === true,
    contactAskedWhoIsThis: params.ctx.contactAskedWhoIsThis === true,
    priorDisclosureConfirmable: true,
  })

  let disclosure: string | null = null
  if (decision.fullIntroRequired && approved && cfg) {
    disclosure = renderIdentityDisclosure(
      { fsaRoleLabel: cfg.fsa_role_label, fullTemplate: cfg.full_template, abbreviatedTemplate: cfg.abbreviated_template },
      {
        ...params.ctx.vars,
        communication: { reason: params.ctx.purpose ?? params.ctx.vars.communication?.reason ?? null },
      },
      'full',
    )
  }

  const reason =
    decision.fullIntroRequired && !approved
      ? `${decision.reason} (identity config not approved — disclosure NOT auto-inserted; approve the config to enable).`
      : decision.reason

  return {
    fullIntro: decision.fullIntroRequired,
    isFirstChannelTouch: decision.flags.isFirstChannelTouch,
    disclosure,
    version: approved && cfg ? cfg.version : null,
    reason,
    configApproved: approved,
  }
}
