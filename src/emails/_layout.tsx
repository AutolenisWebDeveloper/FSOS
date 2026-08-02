// src/emails/_layout.tsx
// ─────────────────────────────────────────────────────────────────────────────
// The shared, premium email SHELL for every FSOS campaign template (author-time, ADR-025).
//
// A Fortune-500-fintech-grade, cross-client shell: a centered white card with a Farmers-blue
// signature accent, an approved-logo letterhead header (§17.1), a personalized sign-off, and a
// compliance-grade footer. All styling is inline + table-based (React Email) and resolves
// through the shared brand tokens (src/lib/email/brand.ts) so it renders consistently across
// Gmail, Outlook, Apple Mail, Yahoo, and mobile.
//
// Compliance surfaces baked in (DESIGN.md §31, CAN-SPAM):
//   • educational disclaimer (red-line reinforcement, §4.2),
//   • the FSA's verified physical mailing address (sender identification),
//   • a visible per-recipient unsubscribe link ({{unsubscribe_url}} — resolved at send).
// It carries NO SMS "Reply STOP" opt-out — the dispatcher appends that for SMS only (§12).
// Merge tokens ({{first_name}}, {{fsa_name}}, …) are literal here and substituted per recipient
// at send by personalize.ts.
import * as React from 'react'
import { Body, Container, Head, Hr, Html, Img, Link, Preview, Section, Text } from '@react-email/components'
import { EMAIL_COLORS as C, EMAIL_FONT, EMAIL_TYPE as T, EMAIL_SPACE as S, EMAIL_LAYOUT as L, EMAIL_BRAND, EMAIL_IDENTITY as ID } from '@/lib/email/brand'

// Progressive-enhancement responsive + dark-mode hints. Inline styles remain the source of
// truth; this only tightens padding on small screens for clients that honor <style>.
const RESPONSIVE_CSS = `
  @media only screen and (max-width:600px){
    .fsos-card{width:100% !important;border-radius:0 !important}
    .fsos-pad{padding-left:22px !important;padding-right:22px !important}
  }
  @media (prefers-color-scheme:dark){ body,.fsos-canvas{background:#0b1526 !important} }
`

const canvas: React.CSSProperties = { backgroundColor: C.canvas, fontFamily: EMAIL_FONT, margin: 0, padding: 0, width: '100%' }
const container: React.CSSProperties = {
  backgroundColor: C.surface,
  borderRadius: `${L.radius}px`,
  borderTop: `4px solid ${C.brand}`,
  margin: '0 auto',
  maxWidth: `${L.maxWidth}px`,
  overflow: 'hidden',
}
const headerPad: React.CSSProperties = { padding: `${S.lg}px ${L.contentPad}px ${S.md}px` }
const contentPad: React.CSSProperties = { padding: `${S.xs}px ${L.contentPad}px ${S.sm}px` }
const footerPad: React.CSSProperties = { padding: `${S.lg}px ${L.contentPad}px ${S.xl}px` }

const signoff: React.CSSProperties = { color: C.body, fontSize: T.body, lineHeight: '24px', margin: `0 0 ${S.xs}px` }
const signoffName: React.CSSProperties = { color: C.brand, fontSize: T.body, fontWeight: 700, margin: 0 }
const signoffMeta: React.CSSProperties = { color: C.muted, fontSize: T.small, lineHeight: '20px', margin: `2px 0 0` }
const hr: React.CSSProperties = { borderColor: C.border, borderTopWidth: '1px', margin: `${S.lg}px 0` }
const contactLine: React.CSSProperties = { color: C.body, fontSize: T.small, lineHeight: '20px', margin: `0 0 ${S.sm}px` }
const disclaimer: React.CSSProperties = { color: C.muted, fontSize: T.fine, lineHeight: '18px', margin: `0 0 ${S.md}px` }
const canspam: React.CSSProperties = { color: C.faint, fontSize: T.micro, lineHeight: '17px', margin: 0 }
const unsubLink: React.CSSProperties = { color: C.primary, textDecoration: 'underline' }
const link: React.CSSProperties = { color: C.primary, textDecoration: 'none' }

/**
 * Wrap an email body. `preview` is the inbox preheader line; children are the message body.
 * The sign-off uses the {{fsa_name}} token so it personalizes at send.
 */
export function EmailLayout({ preview, children }: { preview: string; children: React.ReactNode }) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{RESPONSIVE_CSS}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body style={canvas} className="fsos-canvas">
        {/* Outer breathing room around the card. */}
        <Section style={{ height: `${S.xl}px`, lineHeight: `${S.xl}px`, fontSize: '1px' }}>&nbsp;</Section>

        <Container style={container} className="fsos-card">
          {/* Header — approved Farmers color lockup on white (§17.1), with the FSA identity. */}
          <Section style={headerPad} className="fsos-pad">
            <Img
              src={EMAIL_BRAND.logoUrl}
              alt={EMAIL_BRAND.logoAlt}
              width={EMAIL_BRAND.logoWidth}
              height={EMAIL_BRAND.logoHeight}
              style={{ display: 'block', border: 0, outline: 'none', textDecoration: 'none' }}
            />
            <Text
              style={{
                color: C.muted,
                fontSize: T.eyebrow,
                fontWeight: 700,
                letterSpacing: '0.08em',
                margin: `${S.md}px 0 0`,
                textTransform: 'uppercase',
              }}
            >
              {ID.agent} &nbsp;·&nbsp; {ID.title}
            </Text>
          </Section>

          <Hr style={{ borderColor: C.border, borderTopWidth: '1px', margin: `0 0 ${S.lg}px` }} />

          {/* Message body. */}
          <Section style={contentPad} className="fsos-pad">
            {children}

            <Hr style={hr} />
            <Text style={signoff}>Warm regards,</Text>
            <Text style={signoffName}>{'{{fsa_name}}'}</Text>
            <Text style={signoffMeta}>
              {ID.title} · {ID.carrier}
            </Text>
          </Section>

          {/* Footer — contact + compliance surface (DESIGN.md §31). */}
          <Section style={{ backgroundColor: C.canvas, borderTop: `1px solid ${C.border}` }}>
            <Section style={footerPad} className="fsos-pad">
              <Text style={contactLine}>
                <Link href={`tel:${ID.phone}`} style={link}>
                  {ID.phone}
                </Link>{' '}
                &nbsp;·&nbsp;{' '}
                <Link href={`mailto:${ID.email}`} style={link}>
                  {ID.email}
                </Link>
              </Text>
              <Text style={disclaimer}>
                This message is for educational and informational purposes only. It is not a product
                recommendation or a suitability determination. {ID.licensing}.
              </Text>
              {/*
                CAN-SPAM footer: every marketing email carries the sender's physical mailing address +
                a working, per-recipient unsubscribe link. {{unsubscribe_url}} is substituted at send
                by personalize.ts (sendThroughGate injects the recipient-specific URL); opting out writes
                the enforced DNC store, so future marketing sends are truly suppressed.
              */}
              <Text style={canspam}>
                {ID.brand} · {ID.mailingAddress}
                <br />
                <Link href="{{unsubscribe_url}}" style={unsubLink}>
                  Unsubscribe from marketing emails
                </Link>
              </Text>
            </Section>
          </Section>
        </Container>

        <Section style={{ height: `${S.xl}px`, lineHeight: `${S.xl}px`, fontSize: '1px' }}>&nbsp;</Section>
      </Body>
    </Html>
  )
}
