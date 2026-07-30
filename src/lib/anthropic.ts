// src/lib/anthropic.ts
// Lazy Anthropic client — never instantiate at module level, mirroring the
// getDb()/getResend() convention. The SDK constructor throws when the API key
// is unset, which would crash the whole route module at import time (breaking
// even GET handlers that never call the model, and next build).

import Anthropic from '@anthropic-ai/sdk'

// Current production model for FNA generation. Kept in one place so a model
// migration is a single-line change. claude-sonnet-4-20250514 was deprecated.
export const FNA_MODEL = 'claude-sonnet-5'
export const FNA_MAX_TOKENS = 4096

let _client: Anthropic | null = null

export function getAnthropic(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('[FSOS] ANTHROPIC_API_KEY is not configured')
  }
  // Explicit resilience config (§11.1: every gateway call has a timeout + bounded
  // retry with backoff). The SDK retries idempotent failures (429/5xx/network) with
  // exponential backoff; we cap the per-request wall-clock so a hung upstream can't
  // stall a job until the platform SIGKILLs it.
  _client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 })
  return _client
}
