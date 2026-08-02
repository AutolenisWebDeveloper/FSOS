// src/emails/annual-review-invite.tsx — Slice 9B (ADR-025). Green-zone, recommendation-free.
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, Callout, CtaButton, SecondaryNote } from './_components'

export function AnnualReviewInvite() {
  return (
    <EmailLayout preview="A quick, no-pressure check-in on your coverage">
      <Eyebrow>Annual Coverage Review</Eyebrow>
      <H1>Time for a quick coverage check-in, {'{{first_name}}'}?</H1>
      <Lead>
        Hi {'{{first_name}}'}, it has been a little while since we last reviewed your coverage together. Life
        changes — a new home, a growing family, a new job — can change what matters most.
      </Lead>
      <Callout>
        A review is a short, no-pressure conversation to make sure everything still lines up with where you are
        today. Nothing to prepare — just bring your questions.
      </Callout>
      <CtaButton href="{{scheduling_link}}">Find a time that works</CtaButton>
      <SecondaryNote>Prefer to reply instead? Just hit reply and we&rsquo;ll take it from there.</SecondaryNote>
    </EmailLayout>
  )
}
