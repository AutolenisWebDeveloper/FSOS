// src/emails/_layout.tsx
// Slice 9B — shared email layout for the FSOS campaign templates (author-time, ADR-025).
//
// A neutral, cross-client shell (inline styles, table-safe container, system font stack).
// It carries NO opt-out / AI-disclosure footer — the dispatcher appends the TRAIGA footer at
// send time (§12); baking it in would double it. Merge tokens ({{first_name}} etc.) are
// literal text here and substituted per recipient at send by personalize.ts.
import * as React from 'react'
import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from '@react-email/components'
import { BUSINESS, CONTACT } from '@/lib/site'

const main: React.CSSProperties = { backgroundColor: '#f4f6fb', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: 0 }
const container: React.CSSProperties = { backgroundColor: '#ffffff', margin: '0 auto', maxWidth: '600px', padding: '32px', borderRadius: '8px' }
const signoff: React.CSSProperties = { color: '#1C428B', fontSize: '14px', lineHeight: '22px' }
const hr: React.CSSProperties = { borderColor: '#e5e9f2', margin: '24px 0' }
const fine: React.CSSProperties = { color: '#666666', fontSize: '12px', lineHeight: '18px' }
const canspam: React.CSSProperties = { color: '#8a94a6', fontSize: '11px', lineHeight: '17px', marginTop: '12px' }
const unsubLink: React.CSSProperties = { color: '#1C428B', textDecoration: 'underline' }

// CAN-SPAM sender identification: the FSA's verified physical mailing address (NAP).
const MAILING_ADDRESS = `${CONTACT.address.line1}, ${CONTACT.address.city}, ${CONTACT.address.region} ${CONTACT.address.postal}`

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
          {/*
            CAN-SPAM footer (three-life-campaigns launch, Slice 2): every marketing email
            carries the sender's physical mailing address + a working, per-recipient
            unsubscribe link. The {{unsubscribe_url}} token is substituted at send time by
            personalize.ts (sendThroughGate injects the recipient-specific URL); it resolves
            to a safe /unsubscribe fallback if ever unset. Opting out suppresses future
            marketing sends via the enforced DNC store; policy-servicing messages continue as
            permitted by law.
          */}
          <Text style={canspam}>
            {BUSINESS.brand} · {MAILING_ADDRESS}
            <br />
            <Link href="{{unsubscribe_url}}" style={unsubLink}>Unsubscribe from marketing emails</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
