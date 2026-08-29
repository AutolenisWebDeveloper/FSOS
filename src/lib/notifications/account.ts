// src/lib/notifications/account.ts
// TRANSACTIONAL account email: the password-setup ("set up your account") message a
// newly provisioned portal user receives. Like the other transactional notifications
// (transactional.ts), it routes through the ONE shared, guarded Resend sender
// (lib/messaging.sendEmail), is NOT gated by the marketing compliance dispatcher, and
// carries no product recommendation or securities content (§4/§12). Best-effort:
// the sender never throws into the caller and logs a provider/config failure so a
// broken setup is diagnosable instead of silently swallowed (§16.2).
//
// The link is a Supabase single-use recovery action link (see services/users.ts). It
// is credential-equivalent, so it is delivered ONLY over email to the account owner —
// never returned to the API caller or written to logs.

import { sendEmail, emailConfigured, type SendResult, type SendPolicyOptions } from '@/lib/messaging'
import { BUSINESS, CONTACT } from '@/lib/site'
import { renderEmailShell, paragraphHtml, buttonHtml, detailTableHtml, calloutHtml, fineHtml } from './email-shell'

export interface PasswordSetupEmailInput {
  /** Login email (shown so the recipient knows which address to sign in with). */
  email: string
  /** The single-use, absolute password-setup link. */
  setupUrl: string
  /** The role keys granted to this user (for a plain-language "Access" line). */
  roles: string[]
}

/** Turn a role key ("super_admin") into a human label ("Super Admin"). */
function humanizeRole(role: string): string {
  return role
    .split('_')
    .filter(Boolean)
    .map((w) => (w === 'fsa' ? 'FSA' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** Comma-joined human labels, or a neutral fallback when none. */
function accessLine(roles: string[]): string {
  const labels = roles.map(humanizeRole)
  return labels.length ? labels.join(', ') : '—'
}

/**
 * Build the branded HTML + plaintext for the password-setup email. Pure (no I/O), so
 * it renders identically in tests. All dynamic text is HTML-escaped inside the shell
 * helpers (§13.8).
 */
export function buildPasswordSetupEmail(input: PasswordSetupEmailInput): {
  subject: string
  html: string
  text: string
} {
  const subject = 'Set up your FSOS account'
  const heading = 'Set up your FSOS account'
  const lede =
    'An administrator has created an FSOS account for you. To activate it, choose a password using the secure button below.'

  const contentHtml = [
    paragraphHtml(lede),
    buttonHtml('Create your password', input.setupUrl),
    detailTableHtml([
      { label: 'Sign-in email', value: input.email },
      { label: 'Access', value: accessLine(input.roles) },
    ]),
    calloutHtml(
      'For your security, this link can be used only once and expires. If it stops working, use “Forgot password” on the sign-in page to request a new one.',
    ),
    fineHtml(
      'If you weren’t expecting this, you can ignore this email — the account can’t be used until a password is set.',
    ),
  ].join('\n')

  const html = renderEmailShell({ preheader: lede, eyebrow: 'Account invitation', heading, contentHtml })

  const text = [
    heading,
    '',
    lede,
    '',
    `Set your password: ${input.setupUrl}`,
    '',
    `Sign-in email: ${input.email}`,
    `Access: ${accessLine(input.roles)}`,
    '',
    'For your security, this link can be used only once and expires. If it stops working, use “Forgot password” on the sign-in page to request a new one.',
    'If you weren’t expecting this, you can ignore this email — the account can’t be used until a password is set.',
    '',
    `${BUSINESS.agent} · ${BUSINESS.carrier}`,
    `${CONTACT.phoneDisplay} · ${CONTACT.email}`,
  ].join('\n')

  return { subject, html, text }
}

/**
 * Send the password-setup email. Best-effort: returns the SendResult but never throws.
 * The caller (provisioning service) surfaces `ok`/`skipped` to the operator so a
 * missing/broken Resend setup is visible, without ever exposing the setup link itself.
 */
export async function sendPasswordSetupEmail(input: PasswordSetupEmailInput): Promise<SendResult> {
  if (!input.email) return { ok: false, error: 'no_recipient', skipped: true }
  if (!emailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[notify] email not configured — password-setup email not sent for', input.email)
    return { ok: false, error: 'email_not_configured', skipped: true }
  }
  const { subject, html, text } = buildPasswordSetupEmail(input)
  // GATED at the chokepoint like every other send. The basis is account provisioning: an
  // operator just created this user, and the address is the login identity itself — there is
  // no marketing relationship to consent to. The declaration below satisfies content
  // approval and marks the send non-suppressible; DNC and the red line still apply.
  const policy: SendPolicyOptions = {
    actor: 'system:provisioning',
    purpose: 'TRANSACTIONAL',
    templateKind: 'system_transactional',
    suppressible: false,
    consentWaived: true,
  }
  const result = await sendEmail(input.email, subject, html, text, { policy })
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`[notify] password-setup → ${input.email} failed (user still created):`, result.error)
  }
  return result
}
