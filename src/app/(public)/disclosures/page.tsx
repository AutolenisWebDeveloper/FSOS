import Link from 'next/link'

export const metadata = {
  title: 'Disclosures — Markist Athelus',
  robots: { index: true, follow: true },
  alternates: { canonical: '/disclosures' },
}

// Static public disclosures page. Professional, clearly-labeled, and free of any
// invented Farmers/FFS legal registration numbers or figures (guardrail §2.3).
export default function DisclosuresPage() {
  return (
    <main className="mx-auto max-w-2xl p-8 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Disclosures</h1>
        <p className="text-sm text-muted-foreground">Important information about this site and how we work.</p>
      </header>

      <section className="space-y-2 text-sm leading-relaxed">
        <p>
          This site is a tool used by a Farmers Financial Services Agent (FSA). The FSA is a life- and
          securities-licensed specialist who partners with Farmers agency owners to make life insurance and financial
          services available to their existing clients.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Securities</h2>
        <p className="text-sm leading-relaxed">
          Securities products and services are offered through Farmers Financial Solutions, LLC (FFS). Any securities
          activity is conducted and supervised through FFS. This site is <strong>not</strong> a broker-dealer system of
          record, does not hold securities accounts, and does not accept or process securities orders. No securities
          account numbers, order details, or suitability determinations are collected here.
        </p>
        <p className="text-sm leading-relaxed">
          For information about the nature of the brokerage relationship and services, please refer to the FFS Form CRS
          (Client Relationship Summary), which is available from the FFS-supervised channel. This site does not
          reproduce or replace that document.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Life insurance</h2>
        <p className="text-sm leading-relaxed">
          Life insurance products are offered through Farmers New World Life Insurance Company (FNWL). Product
          availability, features, and terms are subject to the issuing company&apos;s rules and applicable state
          regulation.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">No advice or recommendations</h2>
        <p className="text-sm leading-relaxed">
          No individualized investment, product, or insurance advice or recommendation is provided through this site.
          Information presented here is general and educational. Any recommendation or transaction is handled personally
          by a licensed professional through the appropriate supervised channel.
        </p>
      </section>

      <section className="space-y-2 border-t pt-4 text-sm">
        <p>
          See also our{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            privacy notice
          </Link>{' '}
          and{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            terms of use
          </Link>
          .
        </p>
      </section>
    </main>
  )
}
