// src/lib/comms/consent-version.ts
// A2P 10DLC / TCPA — SERVER-ONLY derivation of the consent-template version stored with
// every captured consent.
//
// The version MUST be derived automatically from the CURRENTLY DEPLOYED consent-template
// content, never hand-maintained: if the checkbox wording drifts, the stored version must
// change with it so a consent record always proves EXACTLY which wording the contact saw.
//
// We combine the human-readable tag (SMS_CONSENT.version, for readability/recordkeeping)
// with a short content hash of the deployed disclosure text (SMS_CONSENT.disclosure). The
// hash pins the exact bytes — mirroring the email-template render_sha approach (ADR-025):
// change the wording → change the hash → change the version, with no manual edit possible
// to forget. This module imports node:crypto and MUST stay server-only (never a client
// component); site.ts stays crypto-free so it can be imported by the browser form.

import { createHash } from 'node:crypto'
import { SMS_CONSENT } from '@/lib/site'

/** Short (8-hex) content hash of the deployed checkbox disclosure text. */
export function smsConsentDisclosureSha(): string {
  return createHash('sha256').update(SMS_CONSENT.disclosure, 'utf8').digest('hex').slice(0, 8)
}

/**
 * The stored consent version: `<human-tag>.<disclosure-sha8>`, e.g. `2026-07-A-info.1a2b3c4d`.
 * Derived from the deployed template content — not a hard-coded string. Any change to the
 * checkbox wording changes the sha, hence the version, automatically.
 */
export function smsConsentVersion(): string {
  return `${SMS_CONSENT.version}.${smsConsentDisclosureSha()}`
}
