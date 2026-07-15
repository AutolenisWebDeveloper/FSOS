import type { Metadata, Viewport } from 'next'
import { DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'

// FSOS Design System typography (docs/design-system.md §2). DM Sans for body/UI,
// DM Mono for the signature labels + every numeric (money, policy #, dates, IDs).
// Exposed as CSS variables so Tailwind's font-sans / font-mono resolve to them.
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-dm-sans',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-dm-mono',
})

export const metadata: Metadata = {
  title: 'FSOS — FSA Command Center',
  description: 'Farmers FSA Operating System — Markist',
  robots: 'noindex, nofollow', // Private internal tool
  // App Router auto-serves src/app/icon.svg as the favicon.
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable}`}>
      <body className="font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  )
}
