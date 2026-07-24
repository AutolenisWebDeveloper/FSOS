// src/emails/_layout.tsx
// Slice 9B — shared email layout for the FSOS campaign templates (author-time, ADR-025).
//
// A neutral, cross-client shell (inline styles, table-safe container, system font stack).
// It carries NO opt-out / AI-disclosure footer — the dispatcher appends the TRAIGA footer at
// send time (§12); baking it in would double it. Merge tokens ({{first_name}} etc.) are
// literal text here and substituted per recipient at send by personalize.ts.
import * as React from 'react'
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components'

const main: React.CSSProperties = { backgroundColor: '#f4f6fb', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: 0 }
const container: React.CSSProperties = { backgroundColor: '#ffffff', margin: '0 auto', maxWidth: '600px', padding: '32px', borderRadius: '8px' }
const signoff: React.CSSProperties = { color: '#1C428B', fontSize: '14px', lineHeight: '22px' }
const hr: React.CSSProperties = { borderColor: '#e5e9f2', margin: '24px 0' }
const fine: React.CSSProperties = { color: '#666666', fontSize: '12px', lineHeight: '18px' }

/**
 * Wrap an email body. `preview` is the inbox preview line. Children are the message body.
 * The sign-off uses the {{fsa_name}} token so it personalizes at send.
 */
export function EmailLayout({ preview, children }: { preview: string; children: React.ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section>{children}</Section>
          <Hr style={hr} />
          <Text style={signoff}>Warm regards,<br />{'{{fsa_name}}'}</Text>
          <Text style={fine}>
            This message is for educational and informational purposes only. It is not a product recommendation or a
            suitability determination.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
