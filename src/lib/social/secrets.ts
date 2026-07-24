// Social OAuth secret key accessor (ADR-025). Mirrors the DOB-key precedent in
// src/lib/data/query.ts: the symmetric key is held in env, never in the DB, and is
// passed per-call into the pgcrypto RPCs (social_channel_set_secret /
// social_channel_secret). Token material is never logged and never client-exposed.

export function socialTokenKey(): string {
  return (
    process.env.SOCIAL_TOKEN_KEY ||
    process.env.FSOS_SOCIAL_TOKEN_KEY ||
    'fsos-dev-social-key-change-me'
  )
}
