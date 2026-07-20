import type { Metadata } from 'next'
import { MarketingNav } from '@/components/public/marketing/MarketingNav'
import { Hero } from '@/components/public/marketing/Hero'
import { ValueProps } from '@/components/public/marketing/ValueProps'
import { Solutions } from '@/components/public/marketing/Solutions'
import { TechExperience } from '@/components/public/marketing/TechExperience'
import { HowItWorks } from '@/components/public/marketing/HowItWorks'
import { Commitments } from '@/components/public/marketing/Commitments'
import { AboutMarkist } from '@/components/public/marketing/AboutMarkist'
import { Resources } from '@/components/public/marketing/Resources'
import { ContactSection } from '@/components/public/marketing/ContactSection'
import { MarketingFooter } from '@/components/public/marketing/MarketingFooter'
import { BUSINESS, CONTACT, siteUrl } from '@/lib/site'

const TITLE = 'Markist Athelus — Farmers Financial Services Agent | Plano, TX'
const DESCRIPTION =
  'Personalized insurance and financial strategies for individuals, families, and business owners in Plano, Frisco, McKinney & surrounding areas. Life insurance, retirement, investments, and more — guided by a licensed professional and modern, secure technology.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: `${BUSINESS.brand}`,
  keywords: [
    'financial advisor Plano TX',
    'life insurance Plano',
    'retirement planning Frisco',
    'Farmers Financial Services Agent',
    'financial planning McKinney',
    'annuities',
    'investment solutions',
  ],
  alternates: { canonical: '/' },
  robots: { index: true, follow: true }, // Public marketing page — override the app-wide noindex.
  openGraph: {
    type: 'website',
    url: siteUrl(),
    title: TITLE,
    description: DESCRIPTION,
    siteName: BUSINESS.brand,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
}

function StructuredData() {
  const base = siteUrl()
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FinancialService',
        '@id': `${base}/#practice`,
        name: BUSINESS.brand,
        description: DESCRIPTION,
        url: base,
        telephone: CONTACT.phoneE164,
        email: CONTACT.email,
        areaServed: CONTACT.serviceAreaCities,
        address: {
          '@type': 'PostalAddress',
          streetAddress: CONTACT.address.line1,
          addressLocality: CONTACT.address.city,
          addressRegion: CONTACT.address.region,
          postalCode: CONTACT.address.postal,
          addressCountry: CONTACT.address.country,
        },
        contactPoint: {
          '@type': 'ContactPoint',
          telephone: CONTACT.phoneE164,
          email: CONTACT.email,
          contactType: 'customer service',
          areaServed: 'US',
          availableLanguage: 'English',
        },
      },
      {
        '@type': 'Person',
        '@id': `${base}/#markist`,
        name: BUSINESS.agent,
        jobTitle: BUSINESS.title,
        worksFor: { '@id': `${base}/#practice` },
        url: `${base}/#about`,
      },
      {
        '@type': 'FAQPage',
        '@id': `${base}/#faq`,
        mainEntity: [
          {
            '@type': 'Question',
            name: 'Is there any cost or obligation to talk?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'No. The initial consultation is complimentary and there is no obligation — it is simply a conversation about your goals and how Markist may be able to help.',
            },
          },
          {
            '@type': 'Question',
            name: 'What areas does Markist Athelus serve?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Markist serves Plano, Frisco, McKinney, and surrounding North Texas communities, with secure, technology-enabled service for remote convenience.',
            },
          },
          {
            '@type': 'Question',
            name: 'How is my personal information protected?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Information is handled in access-controlled systems with encryption in transit, and documents live in a private repository. You choose how you are contacted and can opt out at any time.',
            },
          },
        ],
      },
    ],
  }
  return (
    <script
      type="application/ld+json"
      // JSON-LD is static, self-authored content — safe to inline.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <StructuredData />
      <MarketingNav />
      <main id="main">
        <Hero />
        <ValueProps />
        <Solutions />
        <TechExperience />
        <HowItWorks />
        <Commitments />
        <AboutMarkist />
        <Resources />
        <ContactSection />
      </main>
      <MarketingFooter />
    </div>
  )
}
