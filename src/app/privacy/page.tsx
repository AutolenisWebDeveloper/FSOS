import type { Metadata } from 'next'
import Link from 'next/link'
import PublicFooter from '@/components/PublicFooter'

export const metadata: Metadata = {
  title: 'Privacy Policy — Markist Financial Services',
  robots: { index: true, follow: true },
  alternates: { canonical: '/privacy' },
}

const LAST_UPDATED = 'July 9, 2026'

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <article className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 text-foreground/80">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Last updated {LAST_UPDATED}</p>

        <p className="mt-6 text-[15px] leading-7">
          This Privacy Policy explains how Markist Athelus, a licensed Farmers Financial Services agent based in
          McKinney, Texas (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;), collects, uses, and protects
          information you provide through our client tools, intake forms, workshop registrations, and communications.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Information we collect</h2>
        <p className="mt-2 text-[15px] leading-7">
          We collect information you provide directly — such as your name, contact details, and the financial and
          household information you enter into our fact-finder and needs-analysis forms — as well as records of policies
          and interactions relevant to servicing your accounts. We also collect limited technical information (such as
          IP address) when you submit a form, to help secure and validate submissions.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">How we use your information</h2>
        <p className="mt-2 text-[15px] leading-7">
          We use your information to provide financial-services guidance, prepare needs analyses, service your policies,
          schedule appointments, and communicate with you. We do not sell your personal information.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Communications &amp; consent</h2>
        <p className="mt-2 text-[15px] leading-7">
          With your consent, we may contact you by phone, SMS, and email. Message and data rates may apply. You can
          withdraw consent at any time by replying STOP to a text message, using the unsubscribe link in an email, or
          visiting our{' '}
          <Link href="/unsubscribe" className="font-medium text-primary underline-offset-2 hover:underline">opt-out page</Link>.
          Withdrawing consent does not affect servicing communications required for policies you hold.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">How we store and protect your information</h2>
        <p className="mt-2 text-[15px] leading-7">
          Your information is stored in access-controlled systems with encryption in transit. Documents you upload are
          kept in a private store and are never made publicly accessible. We retain information for as long as necessary
          to provide services and to meet legal, regulatory, and recordkeeping obligations.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Sharing</h2>
        <p className="mt-2 text-[15px] leading-7">
          We share information only as needed to deliver services — for example, with Farmers Financial Services and its
          affiliated carriers and administrators, and with service providers who process communications and data on our
          behalf under confidentiality obligations — or where required by law.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Your choices</h2>
        <p className="mt-2 text-[15px] leading-7">
          You may request access to, correction of, or deletion of your personal information, subject to legal and
          recordkeeping requirements. To make a request, contact us using the details below.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Contact</h2>
        <p className="mt-2 text-[15px] leading-7">
          Questions about this policy or your information? Contact Markist Athelus, Farmers Financial Services,
          McKinney, TX. This document is provided for transparency and is not legal advice.
        </p>
      </article>
      <PublicFooter />
    </div>
  )
}
