import * as React from 'react'
import { Icon, BrandLogo } from './icons'
import { BUSINESS, CONTACT, DISCLOSURES, LICENSING, SOCIAL, loginUrl } from '@/lib/site'

const SOLUTIONS = ['Life Insurance', 'Retirement Planning', 'College Planning', 'Investments', 'Annuities', 'Business Protection']

export function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="foot">
      <div className="shell">
        <div className="foot__top">
          <div className="foot__brand">
            <a className="brand" href="/">
              <BrandLogo />
              <span className="brand__txt">
                <strong>{BUSINESS.agent}</strong>
                <span style={{ color: '#9DB6DE' }}>{BUSINESS.title}</span>
              </span>
            </a>
            <p>
              {BUSINESS.title}, {BUSINESS.carrier}.
              <br />
              {LICENSING}.
              <br />
              Consent-based, transparent client communications.
            </p>
            {/* Official Farmers Insurance logo (full lockup) — §17.1 approved asset,
                rendered unaltered on a white card so it reads on the navy footer. */}
            <span className="foot__carrier">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/farmers-logo.svg" alt="Farmers Insurance" />
            </span>
            {SOCIAL.length > 0 ? (
              <div className="foot__soc">
                {SOCIAL.map((s) => (
                  <a key={s.href} href={s.href} target="_blank" rel="noopener" aria-label={s.label}>
                    <Icon name={s.label.toLowerCase()} strokeWidth={1.7} />
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <p className="foot__h">Solutions</p>
            <ul className="foot__list">
              {SOLUTIONS.map((s) => (
                <li key={s}>
                  <a href="/#solutions">{s}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="foot__h">Resources</p>
            <ul className="foot__list">
              <li><a href="/workshops">Workshops</a></li>
              <li><a href="/#process">How It Works</a></li>
              <li><a href="/#reviews">Client Reviews</a></li>
              <li><a href="/#about">About Markist</a></li>
              <li><a href="/#contact">Contact</a></li>
            </ul>
          </div>

          <div>
            <p className="foot__h">Company</p>
            <ul className="foot__list">
              <li><a href="/#about">About</a></li>
              <li><a href="/#contact">Contact</a></li>
              <li><a href="https://brokercheck.finra.org/" target="_blank" rel="noopener">FINRA BrokerCheck</a></li>
              <li><a href="https://www.investor.gov/CRS" target="_blank" rel="noopener">Investor.gov/CRS</a></li>
              <li><a href={loginUrl()}>Login</a></li>
            </ul>
          </div>

          <div>
            <p className="foot__h">Get in Touch</p>
            <ul className="foot__list foot__contact">
              <li>
                <Icon name="phone" />
                <a href={`tel:${CONTACT.phoneE164}`}>{CONTACT.phoneDisplay}</a>
              </li>
              <li>
                <Icon name="mail" />
                <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
              </li>
              <li>
                <Icon name="pin" />
                <span>
                  {CONTACT.address.line1}
                  <br />
                  {CONTACT.address.city}, {CONTACT.address.region} {CONTACT.address.postal}
                </span>
              </li>
              <li>
                <Icon name="clock" />
                <span>{CONTACT.hoursDisplay}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="foot__legaltext">
          <p>{DISCLOSURES.practice}</p>
          <p>
            Securities offered through Farmers Financial Solutions, LLC, 30700 Russell Ranch Road #214, Westlake Village,
            CA 91362. Member{' '}
            <a href="https://www.finra.org/" target="_blank" rel="noopener">FINRA</a> &amp;{' '}
            <a href="https://www.sipc.org/" target="_blank" rel="noopener">SIPC</a>. Investing involves risk, including
            the possible loss of principal. Life insurance issued by Farmers New World Life Insurance Company, 3120 139th
            Ave. SE, Ste. 300, Bellevue, WA 98005.
          </p>
          <p>{DISCLOSURES.mobile}</p>
        </div>

        <div className="foot__bar">
          <span>© {year} {BUSINESS.agent}. All rights reserved.</span>
          <nav aria-label="Legal">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Use</a>
            <a href="/sms-terms">SMS Terms &amp; Conditions</a>
            <a href="/accessibility">Accessibility</a>
          </nav>
        </div>
      </div>
    </footer>
  )
}
