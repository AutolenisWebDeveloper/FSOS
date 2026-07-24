// Presentation helpers for the social module (labels + status mapping). Kept out
// of the service so both server pages and client components can import them.

import type { SocialPlatform } from './adapters/types'

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
  facebook_page: 'Facebook Page',
  instagram: 'Instagram',
  linkedin_company: 'LinkedIn Company Page',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
}

// Map channel connection status → the fixed StatusBadge key set
// ('draft'|'active'|'pending'|'won'|'lost'|'blocked'|'escalated').
export function channelStatusBadge(status: string): {
  key: 'active' | 'pending' | 'blocked' | 'lost'
  label: string
} {
  switch (status) {
    case 'connected':
      return { key: 'active', label: 'Connected' }
    case 'not_configured':
      return { key: 'pending', label: 'Not configured' }
    case 'expired':
      return { key: 'blocked', label: 'Expired' }
    case 'error':
      return { key: 'blocked', label: 'Error' }
    case 'revoked':
      return { key: 'lost', label: 'Revoked' }
    default:
      return { key: 'pending', label: status }
  }
}
