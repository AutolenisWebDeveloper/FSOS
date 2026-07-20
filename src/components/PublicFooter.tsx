import Link from 'next/link'

// Shared footer for public-facing pages (forms, uploads, events, legal). Keeps
// legal + opt-out links consistent and compliant across the site. Token-based so
// it matches the rest of the FSOS design system on the public surface.

const LINKS = [
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/unsubscribe', label: 'Unsubscribe / Opt-Out' },
]

export default function PublicFooter() {
  return (
    <footer className="mt-7 px-4 pb-8 pt-4 text-center text-xs leading-relaxed text-muted-foreground">
      <nav className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
        {LINKS.map((l, i) => (
          <span key={l.href} className="inline-flex items-center gap-1">
            <Link
              href={l.href}
              className="rounded-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {l.label}
            </Link>
            {i < LINKS.length - 1 ? <span aria-hidden className="text-border">·</span> : null}
          </span>
        ))}
      </nav>
      <p className="mx-auto mt-2 max-w-xl">
        © {new Date().getFullYear()} Markist Athelus · Farmers Financial Services. Educational information only — not
        investment, tax, or legal advice.
      </p>
    </footer>
  )
}
