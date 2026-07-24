// src/emails/referrals.tsx — Slice 9 email templates (ADR-025). Referral + agency-partner
// outreach. Green-zone; the agency-partner note supports delegated on-behalf-of sends (§7).
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'
import { h1, p } from './_styles'

export function ReferralThankYou() {
  return (
    <EmailLayout preview="Thank you for the introduction">
      <Heading style={h1}>Thank you, {'{{first_name}}'}</Heading>
      <Text style={p}>
        Introductions from people we already care about are the highest compliment we can receive — thank you for
        thinking of us. We'll treat anyone you send our way with the same care we bring to you.
      </Text>
      <Text style={p}>If there's ever anything we can do for you in return, you only have to ask.</Text>
    </EmailLayout>
  )
}

export function ReferralRequest() {
  return (
    <EmailLayout preview="Know someone who could use a hand?">
      <Heading style={h1}>Is there someone we can help, {'{{first_name}}'}?</Heading>
      <Text style={p}>
        Much of our work comes from people kind enough to introduce us to friends and family. If someone you know
        has been meaning to sort out their financial protection, we'd be honored to help.
      </Text>
      <Text style={p}>
        There's no obligation — just reply with a name, or pass our note along. We'll take good care of them.
      </Text>
    </EmailLayout>
  )
}

export function AgencyPartnerIntro() {
  return (
    <EmailLayout preview="A quick introduction on behalf of your agency">
      <Heading style={h1}>A quick hello, {'{{first_name}}'}</Heading>
      <Text style={p}>
        As the financial services specialist partnered with {'{{agency_name}}'}, I help their clients with life
        insurance and financial protection — an extra resource alongside the coverage you already have.
      </Text>
      <Text style={p}>
        If you'd ever like a second set of eyes on your financial picture, I'd be glad to help. No pressure — just
        reply whenever it's convenient.
      </Text>
    </EmailLayout>
  )
}
