import type { Metadata } from 'next'
import Link from 'next/link'
import PublicFooter from '@/components/PublicFooter'
import { BUSINESS, CONTACT } from '@/lib/site'

export const metadata: Metadata = {
  title: 'SMS Terms & Conditions — Markist Financial Services',
  description:
    'SMS messaging terms for Markist Athelus / Markist Financial Services: program description, opt-in, message frequency, STOP/HELP, and rates.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/sms-terms' },
}

const LAST_UPDATED = 'July 20, 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-7">{children}</div>
    </section>
  )
}

export default function SmsTermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <article className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 text-foreground/80">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">SMS Terms &amp; Conditions</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Last updated {LAST_UPDATED}</p>

        <p className="mt-6 text-[15px] leading-7">
          These SMS Terms &amp; Conditions govern the text-message program operated by {BUSINESS.agent} /{' '}
          {BUSINESS.brand} (“we,” “us,” “our”). By providing your mobile number and checking the SMS consent box on our
          website, you agree to these terms.
        </p>

        <Section title="Program description">
          <p>
            When you opt in, we may send you text messages related to appointments, requested information, service
            updates, account servicing, and customer support. These are conversational and account-servicing messages —
            not a recurring marketing blast.
          </p>
        </Section>

        <Section title="How you opt in">
          <p>
            Consent is collected through an <strong>affirmative, unchecked</strong> checkbox on our web forms. We do not
            add you to text messaging simply because you provided a phone number. Consent is{' '}
            <strong>not a condition</strong> of purchasing any product or service.
          </p>
          <p>The consent language you agree to reads:</p>
          <blockquote className="mt-2 rounded-md border border-border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
            “By checking this box, I agree to receive SMS messages from {BUSINESS.agent} / {BUSINESS.brand} regarding
            appointments, requested information, service updates, account servicing, and customer support. Message
            frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance. Consent is
            not a condition of purchase.”
          </blockquote>
        </Section>

        <Section title="Message frequency">
          <p>Message frequency varies based on your interactions with us and the services you request.</p>
        </Section>

        <Section title="Message &amp; data rates">
          <p>Message and data rates may apply, depending on your mobile carrier and plan. We do not charge for the messages themselves.</p>
        </Section>

        <Section title="Opt out — reply STOP">
          <p>
            You can cancel the SMS service at any time by texting <strong>STOP</strong> to any message you receive. After
            you send STOP, we will send a one-time confirmation and will not send further texts unless you opt in again.
            You may also opt out via our{' '}
            <Link href="/unsubscribe" className="font-medium text-primary underline-offset-2 hover:underline">
              opt-out page
            </Link>
            .
          </p>
        </Section>

        <Section title="Help — reply HELP">
          <p>
            For help, reply <strong>HELP</strong> to any message, or contact us at{' '}
            <a href={`tel:${CONTACT.phoneE164}`} className="font-medium text-primary underline-offset-2 hover:underline">
              {CONTACT.phoneDisplay}
            </a>{' '}
            or{' '}
            <a href={`mailto:${CONTACT.email}`} className="font-medium text-primary underline-offset-2 hover:underline">
              {CONTACT.email}
            </a>
            .
          </p>
        </Section>

        <Section title="Carriers &amp; delivery">
          <p>
            Carriers are not liable for delayed or undelivered messages. Supported carriers may change. Message delivery
            is subject to effective transmission by your mobile carrier.
          </p>
        </Section>

        <Section title="Privacy">
          <p>
            Your mobile information will not be shared with third parties or affiliates for marketing or promotional
            purposes. Information is shared only with subcontractors in support roles (such as our messaging provider),
            and only to help us deliver the service. See our{' '}
            <Link href="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
              Privacy Policy
            </Link>{' '}
            for details.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>We may update these SMS Terms from time to time. Continued participation after changes constitutes acceptance of the updated terms.</p>
        </Section>

        <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
          This program is not a securities communications channel. Securities activity is handled personally through the
          appropriate licensed, supervised channel. See our{' '}
          <Link href="/disclosures" className="underline hover:text-foreground">
            disclosures
          </Link>
          .
        </p>
      </article>
      <PublicFooter />
    </div>
  )
}
