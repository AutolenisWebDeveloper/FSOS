// src/emails/reviews.tsx — Slice 9 email templates (ADR-025). Review / servicing invites.
// Green-zone: invite a conversation; never assert a specific claim or recommend a product.
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, P, Callout, BulletList, CtaButton, SecondaryNote } from './_components'

export function BeneficiaryReviewReminder() {
  return (
    <EmailLayout preview="A good time to review who's listed on your coverage">
      <Eyebrow>Beneficiary Review</Eyebrow>
      <H1>Is your beneficiary information current, {'{{first_name}}'}?</H1>
      <Lead>
        Life changes — marriages, children, and other milestones — can affect who you&rsquo;d want listed on your
        coverage. It&rsquo;s worth a quick check now and then to make sure everything reflects your wishes today.
      </Lead>
      <Callout>Updating a beneficiary is usually quick, and we&rsquo;re glad to walk through it together.</Callout>
      <CtaButton href="{{scheduling_link}}">Review it together</CtaButton>
      <SecondaryNote>Or just reply and we&rsquo;ll help you check.</SecondaryNote>
    </EmailLayout>
  )
}

export function LifeEventCheckin() {
  return (
    <EmailLayout preview="Big life change? Let's make sure your plan keeps up">
      <Eyebrow>Life-Event Check-In</Eyebrow>
      <H1>Has something changed, {'{{first_name}}'}?</H1>
      <Lead>The big moments often change what financial protection makes sense for you — for example:</Lead>
      <BulletList
        items={[
          'A new home or a move',
          'A new job, promotion, or change in income',
          'A growing family, or a child heading to college',
        ]}
      />
      <P>If any of these are on your horizon, we&rsquo;d be glad to help you think it through.</P>
      <CtaButton href="{{scheduling_link}}">Set up a short conversation</CtaButton>
      <SecondaryNote>Reply any time and we&rsquo;ll find a moment that suits you.</SecondaryNote>
    </EmailLayout>
  )
}

export function CoverageNeedsCheckup() {
  return (
    <EmailLayout preview="A simple way to see where your coverage stands">
      <Eyebrow>Needs Review</Eyebrow>
      <H1>How much protection is enough, {'{{first_name}}'}?</H1>
      <Lead>
        It&rsquo;s one of the most common questions we hear — and one worth answering with real numbers rather than a
        guess. We can walk through a simple, no-pressure needs review based on your goals and your household.
      </Lead>
      <CtaButton href="{{scheduling_link}}">See where you stand</CtaButton>
      <SecondaryNote>Or reply and we&rsquo;ll set up a short review together.</SecondaryNote>
    </EmailLayout>
  )
}

export function YearEndReviewInvite() {
  return (
    <EmailLayout preview="A year-end check-in on your financial picture">
      <Eyebrow>Year-End Review</Eyebrow>
      <H1>Let&rsquo;s close the year on solid footing, {'{{first_name}}'}</H1>
      <Lead>
        Year-end is a natural time to step back and look at the whole picture — what changed this year, what&rsquo;s
        coming next, and whether your protection still lines up with your goals.
      </Lead>
      <CtaButton href="{{scheduling_link}}">Schedule a year-end review</CtaButton>
      <SecondaryNote>Just reply and we&rsquo;ll find a time that works.</SecondaryNote>
    </EmailLayout>
  )
}

export function WinBackLapsedCheckin() {
  return (
    <EmailLayout preview="Checking in on your coverage">
      <Eyebrow>Checking In</Eyebrow>
      <H1>Checking in, {'{{first_name}}'}</H1>
      <Lead>
        Our records suggest there may have been a change in your coverage status. We wanted to reach out and make
        sure you have what you need — and answer any questions if something slipped through.
      </Lead>
      <P>If you&rsquo;d like to review where things stand or explore your options, we&rsquo;re happy to help.</P>
      <CtaButton href="{{scheduling_link}}">Review your options</CtaButton>
      <SecondaryNote>Or just reply and we&rsquo;ll help you sort it out.</SecondaryNote>
    </EmailLayout>
  )
}
