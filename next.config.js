/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdf2json is a CommonJS package that reads its own files at runtime; keep it
  // external so Next doesn't bundle it into the serverless function.
  serverExternalPackages: ['pdf2json'],
  async redirects() {
    // The workshop hub moved from /events to /workshops (spec §3). Keep the old
    // index link alive with a permanent redirect; per-event /events/[id] pages keep
    // rendering (existing links carry a workshop id, not a slug).
    return [{ source: '/events', destination: '/workshops', permanent: true }]
  },
  async headers() {
    // Security headers apply to EVERY response. Search-engine indexing is scoped:
    // the public marketing surface (homepage, legal, disclosures) is indexable so
    // it can generate leads; every authenticated portal + API stays noindex.
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      },
    ]
    const noIndex = { key: 'X-Robots-Tag', value: 'noindex, nofollow' }
    // Every authenticated / private prefix — never indexed.
    const privatePrefixes = [
      '/app/:path*',
      '/admin/:path*',
      '/compliance/:path*',
      '/partner/:path*',
      '/client/:path*',
      '/super/:path*',
      '/api/:path*',
    ]
    return [
      { source: '/(.*)', headers: securityHeaders },
      ...privatePrefixes.map((source) => ({ source, headers: [noIndex] })),
    ]
  },
}

module.exports = nextConfig
