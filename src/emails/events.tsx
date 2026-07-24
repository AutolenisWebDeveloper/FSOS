// src/emails/events.tsx — Slice 9 email templates (ADR-025). Educational events. Green-zone:
// informational sessions, no products sold at the event. Requires workshop consent at send.
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'
import { h1, p } from './_styles'

export function WorkshopInviteEmail() {
  return (
    <EmailLayout preview="You're invited: a short financial-education session">
      <Heading style={h1}>You're invited, {'{{first_name}}'}</Heading>
      <Text style={p}>
        We're hosting a free, no-obligation educational session on the fundamentals of protecting your family
        financially. It's informational only — nothing is sold at the event.
      </Text>
      <Text style={p}>
        If you'd like to join us, reply and we'll send you the details. Guests are welcome, too.
      </Text>
    </EmailLayout>
  )
}

export function WorkshopReminder() {
  return (
    <EmailLayout preview="A friendly reminder about our upcoming session">
      <Heading style={h1}>See you soon, {'{{first_name}}'}?</Heading>
      <Text style={p}>
        This is a friendly reminder about our upcoming educational session. It's a relaxed, informational hour —
        come with questions, leave with a clearer picture, and no pressure at all.
      </Text>
      <Text style={p}>If you need the details again or your plans have changed, just reply and let us know.</Text>
    </EmailLayout>
  )
}
