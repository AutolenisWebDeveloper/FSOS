import type { Metadata } from 'next'
import Link from 'next/link'
import PublicFooter from '@/components/PublicFooter'

export const metadata: Metadata = {
  title: 'Terms of Use — Markist Financial Services',
  robots: { index: true, follow: true },
  alternates: { canonical: '/terms' },
}

const LAST_UPDATED = 'July 9, 2026'

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <article className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 text-foreground/80">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Terms of Service</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Last updated {LAST_UPDATED}</p>

        <p className="mt-6 text-[15px] leading-7">
          These Terms govern your use of the client tools, forms, and workshop registration provided by Markist Athelus,
          a licensed Farmers Financial Services agent (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;). By using
          these tools, you agree to these Terms.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Educational information — not advice</h2>
        <p className="mt-2 text-[15px] leading-7">
          Content provided through these tools is for general educational purposes only and is not investment, tax, or
          legal advice, and is not an offer or solicitation to buy or sell any product. Any recommendation regarding a
          specific product will be made only after a suitability review in accordance with applicable regulations,
          including FINRA Regulation Best Interest where relevant.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Accuracy of information</h2>
        <p className="mt-2 text-[15px] leading-7">
          You agree that the information you provide is accurate and complete to the best of your knowledge. Analyses
          and illustrations depend on the information you supply and are estimates, not guarantees of any outcome, rate,
          or return.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Acceptable use</h2>
        <p className="mt-2 text-[15px] leading-7">
          You agree to use these tools only for their intended purpose, not to submit unlawful or infringing content,
          and not to attempt to disrupt or gain unauthorized access to the systems.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Communications</h2>
        <p className="mt-2 text-[15px] leading-7">
          By providing your contact information and consent, you agree we may contact you by phone, SMS, and email.
          You can opt out at any time — see our{' '}
          <Link href="/unsubscribe" className="font-medium text-primary underline-offset-2 hover:underline">opt-out page</Link>{' '}
          or our{' '}
          <Link href="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">Privacy Policy</Link>.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Limitation of liability</h2>
        <p className="mt-2 text-[15px] leading-7">
          To the extent permitted by law, we are not liable for indirect or consequential damages arising from your use
          of these tools. Nothing in these Terms limits obligations that cannot be limited under applicable law or the
          regulations governing financial-services professionals.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-foreground">Changes</h2>
        <p className="mt-2 text-[15px] leading-7">
          We may update these Terms from time to time. Continued use after an update constitutes acceptance of the
          revised Terms. This document is provided for transparency and is not legal advice.
        </p>
      </article>
      <PublicFooter />
    </div>
  )
}
