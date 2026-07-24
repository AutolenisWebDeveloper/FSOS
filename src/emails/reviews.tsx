// src/emails/reviews.tsx — Slice 9 email templates (ADR-025). Review / servicing invites.
// Green-zone: invite a conversation; never assert a specific claim or recommend a product.
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'
import { h1, p } from './_styles'

export function BeneficiaryReviewReminder() {
  return (
    <EmailLayout preview="A good time to review who's listed on your coverage">
      <Heading style={h1}>Is your beneficiary information current, {'{{first_name}}'}?</Heading>
      <Text style={p}>
        Life changes — marriages, children, and other milestones — can affect who you'd want listed on your
        coverage. It's worth a quick check now and then to make sure everything reflects your wishes today.
      </Text>
      <Text style={p}>
        If you'd like help reviewing or updating your beneficiary information, just reply and we'll walk through
        it together.
      </Text>
    </EmailLayout>
  )
}

export function LifeEventCheckin() {
  return (
    <EmailLayout preview="Big life change? Let's make sure your plan keeps up">
      <Heading style={h1}>Has something changed, {'{{first_name}}'}?</Heading>
      <Text style={p}>
        A new home, a new job, a growing family, or a child heading to college — the big moments often change what
        financial protection makes sense for you.
      </Text>
      <Text style={p}>
        If any of these are on your horizon, we'd be glad to help you think it through. Reply any time and we'll
        set up a short conversation.
      </Text>
    </EmailLayout>
  )
}

export function CoverageNeedsCheckup() {
  return (
    <EmailLayout preview="A simple way to see where your coverage stands">
      <Heading style={h1}>How much protection is enough, {'{{first_name}}'}?</Heading>
      <Text style={p}>
        It's one of the most common questions we hear — and one worth answering with real numbers rather than a
        guess. We can walk through a simple, no-pressure needs review based on your goals and your household.
      </Text>
      <Text style={p}>
        If you'd like to see where you stand, reply and we'll set up a short review together.
      </Text>
    </EmailLayout>
  )
}

export function YearEndReviewInvite() {
  return (
    <EmailLayout preview="A year-end check-in on your financial picture">
      <Heading style={h1}>Let's close the year on solid footing, {'{{first_name}}'}</Heading>
      <Text style={p}>
        Year-end is a natural time to step back and look at the whole picture — what changed this year, what's
        coming next, and whether your protection still lines up with your goals.
      </Text>
      <Text style={p}>
        If you'd like to schedule a brief year-end review, just reply and we'll find a time that works.
      </Text>
    </EmailLayout>
  )
}

export function WinBackLapsedCheckin() {
  return (
    <EmailLayout preview="Checking in on your coverage">
      <Heading style={h1}>Checking in, {'{{first_name}}'}</Heading>
      <Text style={p}>
        Our records suggest there may have been a change in your coverage status. We wanted to reach out and make
        sure you have what you need — and answer any questions if something slipped through.
      </Text>
      <Text style={p}>
        If you'd like to review where things stand or explore your options, just reply and we'll help you sort it out.
      </Text>
    </EmailLayout>
  )
}
