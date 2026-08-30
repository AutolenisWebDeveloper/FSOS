// src/lib/workshops/consent-copy.ts
// THE consent copy for the SETTLED workshop consent model (Gate 1, D-3) — the single
// source shared by the signup forms (what the registrant sees) and the registration
// route (what gets recorded as shown). Bump SIGNUP_FORM_VERSION whenever any
// consent-relevant wording here or on the form changes: the version is stamped on every
// registration row (consent_form_version) as the capture-evidence key.
//
// D-3 wording is FFS-approved language supplied with the Gate 1 decision. Registration
// itself is never conditioned on consent; the ONE optional box governs POST-EVENT
// MARKETING only — reminders ride the registration.

export const SIGNUP_FORM_VERSION = 'signup-v2-2026-08'

/** Shown at the phone field: providing a number opts into THIS workshop's reminder texts. */
export const SMS_REMINDER_DISCLOSURE =
  "We'll text you reminders about this workshop. Msg & data rates may apply. Reply STOP to opt out."

/** The ONE marketing checkbox label (post-event follow-up + future workshops). */
export const MARKETING_OPT_IN_LABEL =
  'Keep me posted about future educational workshops and resources.'

/** Email-reminder basis line recorded in the capture evidence for the email channel. */
export const EMAIL_REMINDER_BASIS =
  'Registration includes email confirmation and reminders for this workshop.'
