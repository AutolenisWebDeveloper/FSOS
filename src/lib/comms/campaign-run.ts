// Pure row → send-context derivation for the legacy drip runner (/api/campaigns/run).
// Extracted so the C-1 rewire (route the runner through sendThroughGate instead of
// the raw sendEmail/sendSms) is unit-testable without a DB (tests/campaign-gate.test.mjs).
//
// This layer ONLY maps a legacy (campaign, customer, step) into the fields the gate
// needs; it enforces nothing itself. In particular it derives:
//   • the securities firewall flag from the DB row (customers.is_security) — NEVER a
//     caller literal (audit M1), so an is_security customer is blocked by the gate;
//   • per-channel consent from the legacy consent_email/consent_sms booleans, surfaced
//     as durableConsentGranted (the additive per-channel consent path in SendContext —
//     the gate still enforces DNC, quiet-hours, recommendation and securities on top);
//   • the approved-template ref (campaigns.template_id) that satisfies gate step 4.
// It adds NO opt-out/AI-disclosure footer — the dispatcher appends TRAIGA_SMS_FOOTER
// to every SMS at send time.

export interface CampaignForSend {
  channel: string
  campaign_id?: string
  /** Approved comm_template linked to this legacy campaign (gate step 4). Null → unapproved. */
  template_id?: string | null
}

export interface CustomerForSend {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  cell_phone?: string | null
  consent_email?: boolean | null
  consent_sms?: boolean | null
  /** Securities firewall flag on the legacy customer row (mig 042). */
  is_security?: boolean | null
}

export interface CampaignStep {
  order: number
  delay_days: number
  subject?: string
  body: string
}

export interface CampaignSend {
  channel: 'sms' | 'email'
  to: string
  subject?: string
  body: string
  /** Legacy per-channel consent, passed to the gate as durable consent evidence. */
  durableConsentGranted: boolean
  /** DB-derived securities firewall flag (never a literal). */
  isSecurity: boolean
  /** Approved-template ref for gate step 4 (null → gate blocks on approved_template). */
  templateId: string | null
}

/** Substitute the green-zone merge tokens the legacy runner supports. */
export function fill(tpl: string, c: { first_name?: string | null; last_name?: string | null }): string {
  return (tpl || '')
    .replace(/\{first_name\}/gi, c.first_name || 'there')
    .replace(/\{last_name\}/gi, c.last_name || '')
    .trim()
}

/**
 * Map a due legacy enrollment's (campaign, customer, step) to the send context the
 * gate consumes, or null when there is no usable contact method for the channel
 * (skip — never send). Consent/DNC/quiet-hours/template/recommendation/securities are
 * all enforced downstream by sendThroughGate; this only derives the row-level inputs.
 */
export function buildCampaignSend(
  campaign: CampaignForSend,
  cust: CustomerForSend,
  step: CampaignStep,
): CampaignSend | null {
  const channel: 'sms' | 'email' = campaign.channel === 'sms' ? 'sms' : 'email'

  let to: string | null
  let consent: boolean
  if (channel === 'email') {
    to = cust.email ?? null
    consent = cust.consent_email === true
  } else {
    to = cust.phone || cust.cell_phone || null
    consent = cust.consent_sms === true
  }
  if (!to) return null

  return {
    channel,
    to,
    subject: channel === 'email' ? fill(step.subject || 'A note from your Farmers agent', cust) : undefined,
    body: fill(step.body, cust),
    durableConsentGranted: consent,
    isSecurity: cust.is_security === true,
    templateId: campaign.template_id ?? null,
  }
}
