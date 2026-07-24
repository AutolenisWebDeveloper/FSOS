// src/lib/comms/library.ts
// Slice 8 (§17) — Campaign library (PURE catalog). Master build instruction §17.
//
// A curated set of pre-built, COMPLIANCE-READY campaign blueprints the FSA can start
// from instead of a blank page. Every blueprint is:
//   • green-zone only — education / invitation, NO individualized recommendation or
//     call-to-action language (§2.2; enforced by the catalog test + re-checked at the
//     template editor and per send by the gate);
//   • footer-free — the dispatcher appends the TRAIGA AI-disclosure + opt-out at send
//     time; blueprint bodies never hardcode it;
//   • purpose-tagged (Slice 7, §9/§10) — the recommended message purpose the campaign
//     built from this blueprint should carry;
//   • claim-declared — a blueprint whose message rests on a SPECIFIC per-recipient claim
//     (a conversion deadline, an appointment time, a coverage/lapse status) sets
//     makesSpecificClaims + the stored fields those claims depend on, so §18 can wire
//     data-confidence (§13): an unverified/conflicting claim is excluded + a verification
//     task raised, never sent on a guess.
//
// This is CODE (version-controlled), not invented Farmers data (§4.3): the bodies are
// generic invitations with green-zone merge tokens; nothing asserts a product fact, a
// commission split, or a carrier rule. Instantiating a blueprint seeds a DRAFT template
// that still goes through human approval before any campaign can use it.
import { TEMPLATE_CATEGORY } from '../validation/schemas'
import type { MessagePurpose } from './purpose'

export type TemplateCategory = (typeof TEMPLATE_CATEGORY)[number]

export interface CampaignBlueprint {
  /** Stable unique key (used to instantiate). */
  key: string
  name: string
  description: string
  channel: 'sms' | 'email'
  /** Recommended message purpose for a campaign built from this blueprint (Slice 7). */
  purpose: MessagePurpose
  category: TemplateCategory
  /** The audience kind this blueprint is written for (the builder still re-checks the gate). */
  audienceKind: 'all_consented' | 'cross_sell' | 'conversion'
  /** Email subject (personalizable). Omitted for SMS. */
  suggestedSubject?: string
  /** Green-zone body with merge tokens. Footer-free; recommendation-free. */
  body: string
  /**
   * True when the message rests on a SPECIFIC per-recipient claim (§13). Such a campaign
   * dispatches with a data-confidence context (§18) so an unverified/conflicting claim is
   * excluded + a verification task raised.
   */
  makesSpecificClaims: boolean
  /** Stored fields the claims depend on (for the §18 data-confidence wiring). */
  claimFields?: string[]
}

// The curated catalog. Ordered greatest-value first. Bodies are deliberately generic
// invitations — no invented deadlines, product facts, or recommendations.
export const CAMPAIGN_BLUEPRINTS: CampaignBlueprint[] = [
  {
    key: 'annual-policy-review-invite',
    name: 'Annual policy review invitation',
    description: 'Invite a household to a no-pressure annual review of their existing coverage. Pure relationship touch.',
    channel: 'email',
    purpose: 'RELATIONSHIP',
    category: 'policy_review',
    audienceKind: 'all_consented',
    suggestedSubject: 'A quick check-in on your coverage, {full_name}',
    body:
      'Hi {full_name}, it has been a little while since we last reviewed your coverage together. ' +
      'Life changes — a new home, a growing family, a new job — can change what matters most. ' +
      'Would you be open to a short, no-pressure review so everything still lines up with where you are today? ' +
      'Just reply and we will find a time that works for you.',
    makesSpecificClaims: false,
  },
  {
    key: 'term-conversion-window-invite',
    name: 'Term conversion window — review invitation',
    description: 'Invite a household with a term policy conversion window to review their options. Deadline is grounded in the stored policy value (§18).',
    channel: 'email',
    purpose: 'POLICY_DEADLINE',
    category: 'term_conversion',
    audienceKind: 'conversion',
    suggestedSubject: 'A time-sensitive option on your term policy, {full_name}',
    body:
      'Hi {full_name}, your term life policy has a conversion window that may be closing before long. ' +
      'It can be worth understanding what options are available to you while the window is open. ' +
      'Would you like to set up a brief call to walk through what this means for your household? ' +
      'Reply any time and we will get something on the calendar.',
    makesSpecificClaims: true,
    claimFields: ['conversion_deadline'],
  },
  {
    key: 'coverage-gap-education',
    name: 'Coverage gap — educational invitation',
    description: 'Educate a cross-sell-gap household on how coverage needs change, and invite a review. No product pitch.',
    channel: 'email',
    purpose: 'MARKETING',
    category: 'educational',
    audienceKind: 'cross_sell',
    suggestedSubject: 'Does your coverage still fit your life, {full_name}?',
    body:
      'Hi {full_name}, many families find that the coverage they set up years ago no longer matches ' +
      'their life today. We put together a short, plain-language overview of the questions worth asking. ' +
      'If it is helpful, we are happy to walk through it together — no pressure, just information. ' +
      'Reply and let us know.',
    makesSpecificClaims: false,
  },
  {
    key: 'win-back-lapsed-check-in',
    name: 'Lapsed coverage — check-in',
    description: 'Re-engage a household whose coverage appears to have lapsed, grounded in the stored policy status (§18).',
    channel: 'email',
    purpose: 'SERVICING',
    category: 'policy_review',
    audienceKind: 'all_consented',
    suggestedSubject: 'Checking in on your coverage, {full_name}',
    body:
      'Hi {full_name}, our records suggest there may have been a change in your coverage status. ' +
      'We wanted to check in and make sure you have what you need. If anything has changed on your end, ' +
      'or you would simply like to review where things stand, just reply and we will help you sort it out.',
    makesSpecificClaims: true,
    claimFields: ['policy_status'],
  },
  {
    key: 'appointment-reminder',
    name: 'Appointment reminder',
    description: 'Remind a household of an upcoming appointment, grounded in the stored appointment time (§18).',
    channel: 'sms',
    purpose: 'APPOINTMENT',
    category: 'appointment',
    audienceKind: 'all_consented',
    body:
      'Hi {full_name}, this is a friendly reminder about your upcoming appointment with our office. ' +
      'If you need to reschedule, just reply and we will find another time. See you soon!',
    makesSpecificClaims: true,
    claimFields: ['appointment_at'],
  },
  {
    key: 'workshop-invite',
    name: 'Educational workshop invitation',
    description: 'Invite a household to an upcoming educational workshop. Requires workshop consent.',
    channel: 'email',
    purpose: 'WORKSHOP',
    category: 'event',
    audienceKind: 'all_consented',
    suggestedSubject: "You're invited: a short financial-education session",
    body:
      'Hi {full_name}, we are hosting a free, no-obligation educational session on the fundamentals of ' +
      'protecting your family financially. It is informational only — no products are sold at the event. ' +
      'If you would like to join, reply and we will send you the details.',
    makesSpecificClaims: false,
  },
  {
    key: 'birthday-greeting',
    name: 'Birthday greeting',
    description: 'A warm birthday touch. Relationship-building only — requires birthday-communication consent.',
    channel: 'sms',
    purpose: 'BIRTHDAY',
    category: 'educational',
    audienceKind: 'all_consented',
    body: 'Happy birthday, {full_name}! Wishing you a wonderful year ahead from all of us at the office.',
    makesSpecificClaims: false,
  },
]

/** The catalog, as a list (stable order). */
export function listBlueprints(): CampaignBlueprint[] {
  return CAMPAIGN_BLUEPRINTS
}

/** Look up a blueprint by key (undefined when unknown). */
export function getBlueprint(key: string): CampaignBlueprint | undefined {
  return CAMPAIGN_BLUEPRINTS.find((b) => b.key === key)
}

/** The draft `comm_template` fields a blueprint seeds (name/channel/category/body). */
export function blueprintToTemplateDraft(bp: CampaignBlueprint): {
  name: string
  channel: 'sms' | 'email'
  category: TemplateCategory
  body: string
} {
  return { name: bp.name, channel: bp.channel, category: bp.category, body: bp.body }
}
