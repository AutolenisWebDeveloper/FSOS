// src/emails/annual-review-invite.tsx — Slice 9B (ADR-025). Green-zone, recommendation-free.
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'

const h: React.CSSProperties = { color: '#1C428B', fontSize: '20px', fontWeight: 700, margin: '0 0 12px' }
const p: React.CSSProperties = { color: '#1a1a1a', fontSize: '15px', lineHeight: '24px', margin: '0 0 16px' }

export function AnnualReviewInvite() {
  return (
    <EmailLayout preview="A quick, no-pressure check-in on your coverage">
      <Heading style={h}>Time for a quick coverage check-in, {'{{first_name}}'}?</Heading>
      <Text style={p}>
        Hi {'{{first_name}}'}, it has been a little while since we last reviewed your coverage together. Life
        changes — a new home, a growing family, a new job — can change what matters most.
      </Text>
      <Text style={p}>
        Would you be open to a short, no-pressure review so everything still lines up with where you are today?
        Just reply and we will find a time that works for you.
      </Text>
    </EmailLayout>
  )
}
