'use client'

import * as React from 'react'
import { Icon, BrandLogo } from './icons'
import { BUSINESS, CONTACT, bookingUrl, loginUrl } from '@/lib/site'

const SOLUTIONS = [
  'Life Insurance',
  'Retirement Planning',
  'College Planning',
  'Investments',
  'Annuities',
  'Business Protection',
]

export function SiteHeader({ active = 'home' }: { active?: 'home' | 'contact' | 'none' }) {
  const [open, setOpen] = React.useState(false)
  const book = bookingUrl()
  const login = loginUrl()
  const bookExternal = book.startsWith('http')

  return (
    <>
      {/* Utility topbar */}
      <div className="util">
        <div className="shell util__in">
          <div className="util__l">
            <a className="util__item" href={`tel:${CONTACT.phoneE164}`}>
              <Icon name="phone" />
              {CONTACT.phoneDisplay}
            </a>
            <a className="util__item" href={`mailto:${CONTACT.email}`}>
              <Icon name="mail" />
              {CONTACT.email}
            </a>
            <span className="util__item">
              <Icon name="pin" />
              {CONTACT.address.city}, {CONTACT.address.region} {CONTACT.address.postal}
            </span>
          </div>
          <span className="util__r">
            <Icon name="shield" />
            Licensed in TX &amp; more
          </span>
        </div>
      </div>

      {/* Header / nav */}
      <header className="head">
        <div className="shell head__in">
          <a className="brand" href="/" aria-label={`${BUSINESS.agent} — home`}>
            <BrandLogo />
            <span className="brand__txt">
              <strong>{BUSINESS.agent}</strong>
              <span>
                {BUSINESS.title} · {BUSINESS.carrier}
              </span>
            </span>
          </a>
          <nav className={`nav${open ? ' open' : ''}`} aria-label="Main">
            <button
              className="burger"
              aria-expanded={open}
              aria-controls="site-navlinks"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name="menu" />
            </button>
            <ul className="nav__links" id="site-navlinks">
              <li>
                <a href="/" aria-current={active === 'home' ? 'page' : undefined}>
                  Home
                </a>
              </li>
              <li>
                <a href="/#solutions">
                  Solutions
                  <Icon name="caret" className="caret" />
                </a>
                <div className="menu">
                  {SOLUTIONS.map((s) => (
                    <a key={s} href="/#solutions" onClick={() => setOpen(false)}>
                      {s}
                    </a>
                  ))}
                </div>
              </li>
              <li>
                <a href="/#about">About</a>
              </li>
              <li>
                <a href="/#process">
                  Resources
                  <Icon name="caret" className="caret" />
                </a>
                <div className="menu">
                  <a href="/#process" onClick={() => setOpen(false)}>
                    How It Works
                  </a>
                  <a href="/#reviews" onClick={() => setOpen(false)}>
                    Client Reviews
                  </a>
                </div>
              </li>
              <li>
                <a href="/#contact" aria-current={active === 'contact' ? 'page' : undefined}>
                  Contact
                </a>
              </li>
            </ul>
            <div className="nav__cta">
              <a className="nav__login" href={login}>
                Login
              </a>
              <a
                className="btn btn--red"
                href={book}
                target={bookExternal ? '_blank' : undefined}
                rel={bookExternal ? 'noopener' : undefined}
              >
                <Icon name="calendar" />
                Schedule Appointment
              </a>
            </div>
          </nav>
        </div>
      </header>
    </>
  )
}
