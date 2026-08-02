// src/emails/_components.tsx
// ─────────────────────────────────────────────────────────────────────────────
// The FSOS EMAIL COMPONENT LIBRARY (author/build-time only, ADR-025).
//
// Reusable, cross-client React Email primitives shared by every campaign template:
// eyebrow, headings, lead/body copy, a bulletproof CTA button, callout cards,
// alerts, a label/value detail table, icon bullet lists, dividers, and spacers.
// Every style resolves through the shared brand tokens (src/lib/email/brand.ts) so
// the email system stays visually consistent with the runtime transactional emails
// and with DESIGN.md — one design system, not a per-template one-off (CLAUDE.md §6).
//
// Determinism (ADR-025): pure presentation, static inline styles, no dates/random —
// the same tree always renders byte-identical HTML + plaintext.
import * as React from 'react'
import { Button, Column, Heading, Hr, Row, Section, Text } from '@react-email/components'
import { EMAIL_COLORS as C, EMAIL_TYPE as T, EMAIL_SPACE as S } from '@/lib/email/brand'

/** Small uppercase category label above the headline (quiet brand accent). */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: C.primary,
        fontSize: T.eyebrow,
        fontWeight: 700,
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        margin: `0 0 ${S.sm}px`,
      }}
    >
      {children}
    </Text>
  )
}

/** Primary headline. */
export function H1({ children }: { children: React.ReactNode }) {
  return (
    <Heading
      as="h1"
      style={{ color: C.ink, fontSize: T.h1, lineHeight: '30px', fontWeight: 700, margin: `0 0 ${S.md}px` }}
    >
      {children}
    </Heading>
  )
}

/** Emphasized lead paragraph directly under the headline. */
export function Lead({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: C.body, fontSize: T.lead, lineHeight: '26px', margin: `0 0 ${S.md}px` }}>
      {children}
    </Text>
  )
}

/** Standard body paragraph. */
export function P({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: C.body, fontSize: T.body, lineHeight: '25px', margin: `0 0 ${S.md}px` }}>
      {children}
    </Text>
  )
}

/**
 * Bulletproof primary CTA. React Email's <Button> emits the MSO padding shim so the
 * fill renders in Outlook. `href` is typically a merge token (e.g. {{scheduling_link}}),
 * resolved per-recipient at send. Green-zone label only — never a product call-to-action.
 */
export function CtaButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Section style={{ margin: `${S.lg}px 0 ${S.sm}px` }}>
      <Button
        href={href}
        style={{
          backgroundColor: C.brand,
          borderRadius: '8px',
          color: C.white,
          display: 'inline-block',
          fontSize: T.body,
          fontWeight: 700,
          lineHeight: '20px',
          padding: '14px 30px',
          textDecoration: 'none',
          textAlign: 'center',
        }}
      >
        {children}
      </Button>
    </Section>
  )
}

/** Soft brand-wash callout card with a Farmers-blue left accent — for a key idea. */
export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <Section
      style={{
        backgroundColor: C.wash,
        borderLeft: `4px solid ${C.brand}`,
        borderRadius: '8px',
        margin: `${S.md}px 0 ${S.lg}px`,
        padding: `${S.md}px ${S.lg}px`,
      }}
    >
      <Text style={{ color: C.ink, fontSize: T.body, lineHeight: '24px', margin: 0 }}>{children}</Text>
    </Section>
  )
}

/**
 * A single label/value detail row for the appointment/detail table. Values are
 * usually merge tokens grounded in stored data at send (ADR-025 / §13).
 */
export interface DetailRowProps {
  label: string
  children: React.ReactNode
}

/** Label/value detail table — used by the appointment lifecycle templates. */
export function DetailTable({ rows }: { rows: DetailRowProps[] }) {
  return (
    <Section
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        margin: `${S.md}px 0 ${S.lg}px`,
        padding: `${S.xs}px ${S.md}px`,
      }}
    >
      {rows.map((r, i) => (
        <Row key={i} style={{ borderTop: i === 0 ? undefined : `1px solid ${C.border}` }}>
          <Column style={{ padding: `${S.sm}px 0`, verticalAlign: 'top', width: '132px' }}>
            <Text
              style={{
                color: C.muted,
                fontSize: T.fine,
                fontWeight: 700,
                letterSpacing: '0.04em',
                margin: 0,
                textTransform: 'uppercase',
              }}
            >
              {r.label}
            </Text>
          </Column>
          <Column style={{ padding: `${S.sm}px 0`, verticalAlign: 'top' }}>
            <Text style={{ color: C.ink, fontSize: T.body, lineHeight: '22px', margin: 0 }}>{r.children}</Text>
          </Column>
        </Row>
      ))}
    </Section>
  )
}

/** Icon bullet list — a light, scannable feature/question list (no <ul> quirks). */
export function BulletList({ items }: { items: React.ReactNode[] }) {
  return (
    <Section style={{ margin: `${S.sm}px 0 ${S.lg}px` }}>
      {items.map((item, i) => (
        <Row key={i}>
          <Column style={{ padding: `${S.xs}px ${S.sm}px ${S.xs}px 0`, verticalAlign: 'top', width: '22px' }}>
            <Text style={{ color: C.brand, fontSize: T.body, fontWeight: 700, lineHeight: '24px', margin: 0 }}>
              &bull;
            </Text>
          </Column>
          <Column style={{ padding: `${S.xs}px 0`, verticalAlign: 'top' }}>
            <Text style={{ color: C.body, fontSize: T.body, lineHeight: '24px', margin: 0 }}>{item}</Text>
          </Column>
        </Row>
      ))}
    </Section>
  )
}

/** Thin hairline divider. */
export function Rule() {
  return <Hr style={{ borderColor: C.border, borderTopWidth: '1px', margin: `${S.lg}px 0` }} />
}

/** Vertical spacer (deterministic, table-safe). */
export function Spacer({ size = S.md }: { size?: number }) {
  return <Section style={{ height: `${size}px`, lineHeight: `${size}px`, fontSize: '1px' }}>&nbsp;</Section>
}

/** A quiet "reply any time" secondary line under a CTA. */
export function SecondaryNote({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: C.muted, fontSize: T.small, lineHeight: '21px', margin: `0 0 ${S.xs}px` }}>{children}</Text>
  )
}
