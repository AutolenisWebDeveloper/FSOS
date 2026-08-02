// src/emails/followups.tsx — Slice 9 email templates (ADR-025). Gentle follow-ups.
// Green-zone: invite the next step, never pressure or recommend a specific product.
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, P, CtaButton, SecondaryNote } from './_components'

export function QuoteFollowUp() {
  return (
    <EmailLayout preview="Any questions on what we put together?">
      <Eyebrow>Following Up</Eyebrow>
      <H1>Happy to answer any questions, {'{{first_name}}'}</H1>
      <Lead>
        We wanted to follow up on the information we shared. Take whatever time you need — decisions like this
        deserve a little thought, and there&rsquo;s no rush on our end.
      </Lead>
      <P>If anything is unclear or you&rsquo;d like to talk through the options, we&rsquo;re glad to help.</P>
      <CtaButton href="{{scheduling_link}}">Talk it through</CtaButton>
      <SecondaryNote>Or just reply and we&rsquo;ll walk through it together.</SecondaryNote>
    </EmailLayout>
  )
}

export function CoverageQuestionsFollowUp() {
  return (
    <EmailLayout preview="Still here if questions come up">
      <Eyebrow>Still Here For You</Eyebrow>
      <H1>Still here for you, {'{{first_name}}'}</H1>
      <Lead>
        We know these decisions aren&rsquo;t always at the top of the to-do list, and that&rsquo;s okay. Whenever you&rsquo;re
        ready, we&rsquo;re glad to pick the conversation back up right where it left off.
      </Lead>
      <P>Just reply with what&rsquo;s on your mind, and we&rsquo;ll take it from there.</P>
      <CtaButton href="{{scheduling_link}}">Pick up where we left off</CtaButton>
    </EmailLayout>
  )
}

export function ReconnectCheckin() {
  return (
    <EmailLayout preview="It's been a while — how are things?">
      <Eyebrow>Checking In</Eyebrow>
      <H1>It&rsquo;s been a while, {'{{first_name}}'}</H1>
      <Lead>
        We were thinking of you and wanted to check in. A lot can change in a year, and we&rsquo;d love to hear how
        things are going — and make sure your plan still fits your life.
      </Lead>
      <P>No agenda here — just reply and say hello whenever you have a moment.</P>
      <CtaButton href="{{scheduling_link}}">Catch up soon</CtaButton>
    </EmailLayout>
  )
}
