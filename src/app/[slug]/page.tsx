import type { Metadata } from 'next'
import { BUSINESS } from '@/lib/site'
import ReferralClient from './ReferralClient'

// Server wrapper: a 'use client' page can't export metadata, so the interactive
// referral form lives in ReferralClient and this segment supplies the metadata.
// Per-agency referral links are not a public-SEO surface — kept noindex.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Refer a client — ${BUSINESS.agent}, ${BUSINESS.carrier}`,
  description: `Submit a client referral to ${BUSINESS.agent}, ${BUSINESS.title} with ${BUSINESS.carrier}. Your client receives a secure questionnaire to prepare for their financial review.`,
  robots: { index: false, follow: false },
}

// Public route — no auth required.
export default function AgencyReferralPage() {
  return <ReferralClient />
}
