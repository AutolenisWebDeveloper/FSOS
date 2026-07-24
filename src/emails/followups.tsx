// src/emails/followups.tsx — Slice 9 email templates (ADR-025). Gentle follow-ups.
// Green-zone: invite the next step, never pressure or recommend a specific product.
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'
import { h1, p } from './_styles'

export function QuoteFollowUp() {
  return (
    <EmailLayout preview="Any questions on what we put together?">
      <Heading style={h1}>Happy to answer any questions, {'{{first_name}}'}</Heading>
      <Text style={p}>
        We wanted to follow up on the information we shared. Take whatever time you need — decisions like this
        deserve a little thought, and there's no rush on our end.
      </Text>
      <Text style={p}>
        If anything is unclear or you'd like to talk through the options, just reply and we'll walk through it
        together.
      </Text>
    </EmailLayout>
  )
}

export function CoverageQuestionsFollowUp() {
  return (
    <EmailLayout preview="Still here if questions come up">
      <Heading style={h1}>Still here for you, {'{{first_name}}'}</Heading>
      <Text style={p}>
        We know these decisions aren't always at the top of the to-do list, and that's okay. Whenever you're
        ready, we're glad to pick the conversation back up right where it left off.
      </Text>
      <Text style={p}>Just reply with what's on your mind, and we'll take it from there.</Text>
    </EmailLayout>
  )
}

export function ReconnectCheckin() {
  return (
    <EmailLayout preview="It's been a while — how are things?">
      <Heading style={h1}>It's been a while, {'{{first_name}}'}</Heading>
      <Text style={p}>
        We were thinking of you and wanted to check in. A lot can change in a year, and we'd love to hear how
        things are going — and make sure your plan still fits your life.
      </Text>
      <Text style={p}>No agenda here — just reply and say hello whenever you have a moment.</Text>
    </EmailLayout>
  )
}
