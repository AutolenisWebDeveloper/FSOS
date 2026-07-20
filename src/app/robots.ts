import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

// The public marketing surface is crawlable so it can generate leads; every
// authenticated portal + API stays disallowed.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl()
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app/', '/admin/', '/compliance/', '/partner/', '/client/', '/super/', '/api/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
