import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteShell } from '@/components/public/site/SiteShell'

export const metadata: Metadata = {
  title: 'Disclosures — Markist Athelus',
  description:
    'Important disclosures for Markist Athelus, Financial Services Agent with Farmers Insurance — securities through Farmers Financial Solutions, life insurance through Farmers New World Life, and our no-advice policy.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/disclosures' },
}

const TOC = [
  ['overview', 'Overview'],
  ['securities', 'Securities'],
  ['life', 'Life insurance'],
  ['advice', 'No advice or recommendations'],
  ['more', 'Related policies'],
]

// Public disclosures page. Wrapped in the marketing SiteShell so it carries the
// same header/footer/brand chrome as the other legal pages (privacy, terms,
// sms-terms, accessibility) instead of rendering as an unbranded orphan.
// Professional, clearly-labeled, and free of any invented Farmers/FFS legal
// registration numbers or figures (guardrail §2.3).
export default function DisclosuresPage() {
  return (
    <SiteShell>
      <main id="main" className="doc">
        <div className="shell doc__grid">
          <nav className="toc" aria-label="On this page">
            <p className="toc__h">On this page</p>
            <ol>
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`}>{label}</a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="prose">
            <h1>Disclosures</h1>
            <p className="stamp">Important information about this site and how we work.</p>

            <h2 id="overview">1. Overview</h2>
            <p>
              This site is a tool used by a Farmers Financial Services Agent (FSA). The FSA is a life- and
              securities-licensed specialist who partners with Farmers agency owners to make life insurance and financial
              services available to their existing clients.
            </p>

            <h2 id="securities">2. Securities</h2>
            <p>
              Securities products and services are offered through Farmers Financial Solutions, LLC (FFS). Any securities
              activity is conducted and supervised through FFS. This site is <strong>not</strong> a broker-dealer system of
              record, does not hold securities accounts, and does not accept or process securities orders. No securities
              account numbers, order details, or suitability determinations are collected here.
            </p>
            <p>
              For information about the nature of the brokerage relationship and services, please refer to the FFS Form CRS
              (Client Relationship Summary), which is available from the FFS-supervised channel. This site does not
              reproduce or replace that document.
            </p>

            <h2 id="life">3. Life insurance</h2>
            <p>
              Life insurance products are offered through Farmers New World Life Insurance Company (FNWL). Product
              availability, features, and terms are subject to the issuing company&apos;s rules and applicable state
              regulation.
            </p>

            <h2 id="advice">4. No advice or recommendations</h2>
            <p>
              No individualized investment, product, or insurance advice or recommendation is provided through this site.
              Information presented here is general and educational. Any recommendation or transaction is handled personally
              by a licensed professional through the appropriate supervised channel.
            </p>

            <h2 id="more">5. Related policies</h2>
            <p>
              See also our <Link href="/privacy">Privacy Policy</Link>, <Link href="/terms">Terms of Use</Link>, and{' '}
              <Link href="/sms-terms">SMS Terms &amp; Conditions</Link>.
            </p>
          </article>
        </div>
      </main>
    </SiteShell>
  )
}
