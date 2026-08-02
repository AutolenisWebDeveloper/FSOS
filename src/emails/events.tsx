// src/emails/events.tsx — Slice 9 email templates (ADR-025). Educational events. Green-zone:
// informational sessions, no products sold at the event. Requires workshop consent at send.
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, Callout, CtaButton, SecondaryNote } from './_components'

export function WorkshopInviteEmail() {
  return (
    <EmailLayout preview="You're invited: a short financial-education session">
      <Eyebrow>You&rsquo;re Invited</Eyebrow>
      <H1>You&rsquo;re invited, {'{{first_name}}'}</H1>
      <Lead>
        We&rsquo;re hosting a free, no-obligation educational session on the fundamentals of protecting your family
        financially.
      </Lead>
      <Callout>It&rsquo;s informational only — nothing is sold at the event, and guests are welcome too.</Callout>
      <CtaButton href="{{scheduling_link}}">Reserve your seat</CtaButton>
      <SecondaryNote>Prefer to reply? Let us know and we&rsquo;ll send you the details.</SecondaryNote>
    </EmailLayout>
  )
}

export function WorkshopReminder() {
  return (
    <EmailLayout preview="A friendly reminder about our upcoming session">
      <Eyebrow>Event Reminder</Eyebrow>
      <H1>See you soon, {'{{first_name}}'}?</H1>
      <Lead>
        This is a friendly reminder about our upcoming educational session. It&rsquo;s a relaxed, informational hour —
        come with questions, leave with a clearer picture, and no pressure at all.
      </Lead>
      <CtaButton href="{{scheduling_link}}">Confirm your spot</CtaButton>
      <SecondaryNote>Need the details again or plans changed? Just reply and let us know.</SecondaryNote>
    </EmailLayout>
  )
}
