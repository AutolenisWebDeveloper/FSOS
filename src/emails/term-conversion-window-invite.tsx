// src/emails/term-conversion-window-invite.tsx — Slice 9B (ADR-025). Green-zone; the
// deadline is grounded in stored data at send time (§13/§18), never asserted here.
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'

const h: React.CSSProperties = { color: '#1C428B', fontSize: '20px', fontWeight: 700, margin: '0 0 12px' }
const p: React.CSSProperties = { color: '#1a1a1a', fontSize: '15px', lineHeight: '24px', margin: '0 0 16px' }

export function TermConversionWindowInvite() {
  return (
    <EmailLayout preview="A time-sensitive option on your term policy">
      <Heading style={h}>A time-sensitive option worth understanding, {'{{first_name}}'}</Heading>
      <Text style={p}>
        Hi {'{{first_name}}'}, many term life policies include a conversion window — a limited period when you may
        be able to convert term coverage to a permanent policy without new medical underwriting. If your coverage
        includes one, it can be worth understanding your options while the window is open.
      </Text>
      <Text style={p}>
        Would you like to set up a brief call to walk through what this means for your household? Reply any time
        and we will get something on the calendar.
      </Text>
    </EmailLayout>
  )
}
