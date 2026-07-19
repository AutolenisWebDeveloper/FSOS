import type { MetadataRoute } from 'next'

// Private internal tool — block all indexing.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
  }
}
