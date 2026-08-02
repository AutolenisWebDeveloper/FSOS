// src/emails/referrals.tsx — Slice 9 email templates (ADR-025). Referral + agency-partner
// outreach. Green-zone; the agency-partner note supports delegated on-behalf-of sends (§7).
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, P, Callout, CtaButton, SecondaryNote } from './_components'

export function ReferralThankYou() {
  return (
    <EmailLayout preview="Thank you for the introduction">
      <Eyebrow>Thank You</Eyebrow>
      <H1>Thank you, {'{{first_name}}'}</H1>
      <Lead>
        Introductions from people we already care about are the highest compliment we can receive — thank you for
        thinking of us. We&rsquo;ll treat anyone you send our way with the same care we bring to you.
      </Lead>
      <P>If there&rsquo;s ever anything we can do for you in return, you only have to ask.</P>
    </EmailLayout>
  )
}

export function ReferralRequest() {
  return (
    <EmailLayout preview="Know someone who could use a hand?">
      <Eyebrow>A Small Ask</Eyebrow>
      <H1>Is there someone we can help, {'{{first_name}}'}?</H1>
      <Lead>
        Much of our work comes from people kind enough to introduce us to friends and family. If someone you know
        has been meaning to sort out their financial protection, we&rsquo;d be honored to help.
      </Lead>
      <Callout>
        There&rsquo;s no obligation — just reply with a name, or pass our note along. We&rsquo;ll take good care of them.
      </Callout>
    </EmailLayout>
  )
}

export function AgencyPartnerIntro() {
  return (
    <EmailLayout preview="A quick introduction on behalf of your agency">
      <Eyebrow>An Introduction</Eyebrow>
      <H1>A quick hello, {'{{first_name}}'}</H1>
      <Lead>
        As the financial services specialist partnered with {'{{agency_name}}'}, I help their clients with life
        insurance and financial protection — an extra resource alongside the coverage you already have.
      </Lead>
      <P>If you&rsquo;d ever like a second set of eyes on your financial picture, I&rsquo;d be glad to help. No pressure.</P>
      <CtaButton href="{{scheduling_link}}">Schedule a quick chat</CtaButton>
      <SecondaryNote>Or just reply whenever it&rsquo;s convenient.</SecondaryNote>
    </EmailLayout>
  )
}
