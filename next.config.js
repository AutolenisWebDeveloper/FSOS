/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdf2json is a CommonJS package that reads its own files at runtime; keep it
  // external so Next doesn't bundle it into the serverless function.
  serverExternalPackages: ['pdf2json'],
  async headers() {
    return [
      {
        // Security headers applied to every response. This is a private
        // internal tool, so we also instruct crawlers not to index it.
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
