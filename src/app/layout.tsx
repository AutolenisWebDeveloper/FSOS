import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FSOS — FSA Command Center',
  description: 'Farmers FSA Operating System — Markist',
  robots: 'noindex, nofollow',  // Private internal tool
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
