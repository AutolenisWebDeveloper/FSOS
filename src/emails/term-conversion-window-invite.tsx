// src/emails/term-conversion-window-invite.tsx — Slice 9B (ADR-025). Green-zone; the
// deadline is grounded in stored data at send time (§13/§18), never asserted here.
import * as React from 'react'
import { EmailLayout } from './_layout'
import { Eyebrow, H1, Lead, Callout, CtaButton, SecondaryNote } from './_components'

export function TermConversionWindowInvite() {
  return (
    <EmailLayout preview="A time-sensitive option on your term policy">
      <Eyebrow>Term Conversion Window</Eyebrow>
      <H1>A time-sensitive option worth understanding, {'{{first_name}}'}</H1>
      <Lead>
        Hi {'{{first_name}}'}, many term life policies include a conversion window — a limited period when you may
        be able to convert term coverage to a permanent policy without new medical underwriting.
      </Lead>
      <Callout>
        If your coverage includes one, it can be worth understanding your options while the window is open. This
        note is informational only — no decision is needed today.
      </Callout>
      <CtaButton href="{{scheduling_link}}">Schedule a brief call</CtaButton>
      <SecondaryNote>Or reply any time and we&rsquo;ll get something on the calendar.</SecondaryNote>
    </EmailLayout>
  )
}
