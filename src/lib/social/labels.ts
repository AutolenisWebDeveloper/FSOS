// Presentation helpers for the social module (labels + status mapping). Kept out
// of the service so both server pages and client components can import them.

import type { SocialPlatform } from './adapters/types'

// Per-platform body character limits (config defaults — verify against current
// platform docs before relying on them; §4.3 assumptions).
export const PLATFORM_BODY_LIMITS: Record<SocialPlatform, number> = {
  youtube: 5000,
  facebook_page: 63206,
  instagram: 2200,
  linkedin_company: 3000,
  x: 280,
  tiktok: 2200,
}

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
  facebook_page: 'Facebook Page',
  instagram: 'Instagram',
  linkedin_company: 'LinkedIn Company Page',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
}

// Map content lifecycle status → the fixed StatusBadge key set.
export function contentStatusBadge(status: string): {
  key: 'draft' | 'pending' | 'won' | 'active' | 'lost' | 'blocked'
  label: string
} {
  switch (status) {
    case 'DRAFT':
      return { key: 'draft', label: 'Draft' }
    case 'IN_REVIEW':
      return { key: 'pending', label: 'In review' }
    case 'APPROVED':
      return { key: 'won', label: 'Approved' }
    case 'SCHEDULED':
      return { key: 'active', label: 'Scheduled' }
    case 'PUBLISHING':
      return { key: 'active', label: 'Publishing' }
    case 'PUBLISHED':
      return { key: 'won', label: 'Published' }
    case 'FAILED':
      return { key: 'lost', label: 'Failed' }
    case 'ARCHIVED':
      return { key: 'blocked', label: 'Archived' }
    default:
      return { key: 'draft', label: status }
  }
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
