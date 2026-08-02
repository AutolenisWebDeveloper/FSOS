// src/emails/coverage-gap-education.tsx — Slice 9B (ADR-025). Educational invitation only,
// recommendation-free (no product pitch).
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, BulletList, CtaButton, SecondaryNote } from './_components'

export function CoverageGapEducation() {
  return (
    <EmailLayout preview="Does your coverage still fit your life?">
      <Eyebrow>Coverage Check</Eyebrow>
      <H1>Does your coverage still fit your life, {'{{first_name}}'}?</H1>
      <Lead>
        Hi {'{{first_name}}'}, many families find that the coverage they set up years ago no longer matches their
        life today. A few plain-language questions are usually worth asking:
      </Lead>
      <BulletList
        items={[
          'Has your household, income, or debt changed since you last looked?',
          'Would your family keep the same standard of living without you?',
          'Is everyone you want protected still reflected in your coverage?',
        ]}
      />
      <CtaButton href="{{scheduling_link}}">Walk through it together</CtaButton>
      <SecondaryNote>No pressure, just information — reply and let us know a good time.</SecondaryNote>
    </EmailLayout>
  )
}
