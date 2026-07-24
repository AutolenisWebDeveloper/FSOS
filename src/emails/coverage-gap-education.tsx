// src/emails/coverage-gap-education.tsx — Slice 9B (ADR-025). Educational invitation only,
// recommendation-free (no product pitch).
import * as React from 'react'
import { Heading, Text } from '@react-email/components'
import { EmailLayout } from './_layout'

const h: React.CSSProperties = { color: '#1C428B', fontSize: '20px', fontWeight: 700, margin: '0 0 12px' }
const p: React.CSSProperties = { color: '#1a1a1a', fontSize: '15px', lineHeight: '24px', margin: '0 0 16px' }

export function CoverageGapEducation() {
  return (
    <EmailLayout preview="Does your coverage still fit your life?">
      <Heading style={h}>Does your coverage still fit your life, {'{{first_name}}'}?</Heading>
      <Text style={p}>
        Hi {'{{first_name}}'}, many families find that the coverage they set up years ago no longer matches their
        life today. We put together a short, plain-language overview of the questions worth asking.
      </Text>
      <Text style={p}>
        If it is helpful, we are happy to walk through it together — no pressure, just information. Reply and let
        us know.
      </Text>
    </EmailLayout>
  )
}
