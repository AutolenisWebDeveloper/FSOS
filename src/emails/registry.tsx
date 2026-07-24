// src/emails/registry.tsx
// Slice 9 — the email-template registry (author-time, ADR-025). Each entry maps a stable
// source_key to its React Email element + the comm_templates metadata the generation script
// writes (name / channel / category). source_key ties a stored template back to the exact
// component that produced it, so re-rendering updates the same draft (idempotent).
//
// Every template is green-zone (education / invitation), recommendation-free (build-gated by
// tests/email-determinism.test.mjs), and footer-free (the dispatcher appends the TRAIGA
// AI-disclosure + opt-out at send). Specific claims (a conversion deadline, an appointment
// time) are grounded in stored data at send (§13/§18) — the copy never asserts an invented fact.
import * as React from 'react'
import { AnnualReviewInvite } from './annual-review-invite'
import { TermConversionWindowInvite } from './term-conversion-window-invite'
import { CoverageGapEducation } from './coverage-gap-education'
import { WelcomeNewClient, BirthdayGreetingEmail, PolicyAnniversary, HolidayGreeting } from './lifecycle'
import { BeneficiaryReviewReminder, LifeEventCheckin, CoverageNeedsCheckup, YearEndReviewInvite, WinBackLapsedCheckin } from './reviews'
import { LifeInsuranceBasics, EmergencyFundEducation, IncomeProtectionEducation, RetirementReadinessEducation, CollegeSavingsEducation, EstatePlanningBasics } from './education'
import { WorkshopInviteEmail, WorkshopReminder } from './events'
import { ReferralThankYou, ReferralRequest, AgencyPartnerIntro } from './referrals'
import { AppointmentConfirmation, AppointmentReminderEmail, AppointmentRecap, RescheduleInvite } from './appointments'
import { QuoteFollowUp, CoverageQuestionsFollowUp, ReconnectCheckin } from './followups'

export interface EmailTemplateEntry {
  sourceKey: string
  name: string
  channel: 'email'
  category: string
  element: React.ReactElement
}

export const EMAIL_TEMPLATES: EmailTemplateEntry[] = [
  // ── Core review / conversion / cross-sell (exemplars) ──
  { sourceKey: 'annual-review-invite', name: 'Annual policy review invitation', channel: 'email', category: 'policy_review', element: <AnnualReviewInvite /> },
  { sourceKey: 'term-conversion-window-invite', name: 'Term conversion window — review invitation', channel: 'email', category: 'term_conversion', element: <TermConversionWindowInvite /> },
  { sourceKey: 'coverage-gap-education', name: 'Coverage gap — educational invitation', channel: 'email', category: 'educational', element: <CoverageGapEducation /> },

  // ── Relationship / lifecycle ──
  { sourceKey: 'welcome-new-client', name: 'Welcome — new client', channel: 'email', category: 'policy_review', element: <WelcomeNewClient /> },
  { sourceKey: 'birthday-greeting-email', name: 'Birthday greeting (email)', channel: 'email', category: 'educational', element: <BirthdayGreetingEmail /> },
  { sourceKey: 'policy-anniversary', name: 'Policy anniversary', channel: 'email', category: 'policy_review', element: <PolicyAnniversary /> },
  { sourceKey: 'holiday-greeting', name: 'Seasonal / holiday greeting', channel: 'email', category: 'educational', element: <HolidayGreeting /> },

  // ── Review / servicing invites ──
  { sourceKey: 'beneficiary-review-reminder', name: 'Beneficiary review reminder', channel: 'email', category: 'policy_review', element: <BeneficiaryReviewReminder /> },
  { sourceKey: 'life-event-checkin', name: 'Life-event check-in', channel: 'email', category: 'policy_review', element: <LifeEventCheckin /> },
  { sourceKey: 'coverage-needs-checkup', name: 'Coverage needs check-up (FNA invite)', channel: 'email', category: 'educational', element: <CoverageNeedsCheckup /> },
  { sourceKey: 'year-end-review-invite', name: 'Year-end review invitation', channel: 'email', category: 'policy_review', element: <YearEndReviewInvite /> },
  { sourceKey: 'win-back-lapsed-checkin', name: 'Lapsed coverage — check-in', channel: 'email', category: 'policy_review', element: <WinBackLapsedCheckin /> },

  // ── Financial-wellness education (green-zone only) ──
  { sourceKey: 'life-insurance-basics', name: 'Life insurance basics', channel: 'email', category: 'educational', element: <LifeInsuranceBasics /> },
  { sourceKey: 'emergency-fund-education', name: 'Emergency fund education', channel: 'email', category: 'educational', element: <EmergencyFundEducation /> },
  { sourceKey: 'income-protection-education', name: 'Income protection education', channel: 'email', category: 'educational', element: <IncomeProtectionEducation /> },
  { sourceKey: 'retirement-readiness-education', name: 'Retirement readiness education', channel: 'email', category: 'educational', element: <RetirementReadinessEducation /> },
  { sourceKey: 'college-savings-education', name: 'College savings education', channel: 'email', category: 'educational', element: <CollegeSavingsEducation /> },
  { sourceKey: 'estate-planning-basics', name: 'Estate planning basics', channel: 'email', category: 'educational', element: <EstatePlanningBasics /> },

  // ── Educational events ──
  { sourceKey: 'workshop-invite-email', name: 'Educational workshop invitation (email)', channel: 'email', category: 'event', element: <WorkshopInviteEmail /> },
  { sourceKey: 'workshop-reminder', name: 'Workshop reminder', channel: 'email', category: 'event', element: <WorkshopReminder /> },

  // ── Referral / agency partnership ──
  { sourceKey: 'referral-thank-you', name: 'Referral thank-you', channel: 'email', category: 'referral', element: <ReferralThankYou /> },
  { sourceKey: 'referral-request', name: 'Referral request', channel: 'email', category: 'referral', element: <ReferralRequest /> },
  { sourceKey: 'agency-partner-intro', name: 'Agency-partner introduction (delegated)', channel: 'email', category: 'agency', element: <AgencyPartnerIntro /> },

  // ── Appointment lifecycle ──
  { sourceKey: 'appointment-confirmation', name: 'Appointment confirmation', channel: 'email', category: 'appointment', element: <AppointmentConfirmation /> },
  { sourceKey: 'appointment-reminder-email', name: 'Appointment reminder (email)', channel: 'email', category: 'appointment', element: <AppointmentReminderEmail /> },
  { sourceKey: 'appointment-recap', name: 'Appointment recap / follow-up', channel: 'email', category: 'appointment', element: <AppointmentRecap /> },
  { sourceKey: 'reschedule-invite', name: 'Reschedule invitation', channel: 'email', category: 'appointment', element: <RescheduleInvite /> },

  // ── Gentle follow-ups ──
  { sourceKey: 'quote-follow-up', name: 'Quote / information follow-up', channel: 'email', category: 'educational', element: <QuoteFollowUp /> },
  { sourceKey: 'coverage-questions-followup', name: 'Coverage questions follow-up', channel: 'email', category: 'educational', element: <CoverageQuestionsFollowUp /> },
  { sourceKey: 'reconnect-checkin', name: 'Reconnect check-in', channel: 'email', category: 'educational', element: <ReconnectCheckin /> },
]
