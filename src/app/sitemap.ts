import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

// Public, indexable routes only. Authenticated portals are excluded (see robots).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl()
  const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/about', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/events', priority: 0.6, changeFrequency: 'weekly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/sms-terms', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/accessibility', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/disclosures', priority: 0.3, changeFrequency: 'yearly' },
  ]
  return routes.map((r) => ({
    url: `${base}${r.path === '/' ? '' : r.path}`,
    lastModified: new Date(),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }))
}
