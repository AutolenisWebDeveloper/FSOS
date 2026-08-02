# Booking Modernization — Deploy & Rollback Notes

> Running checklist of deployment prerequisites and rollback levers introduced by the booking
> modernization phases. Reviewed before any production deploy of this program. Nothing here is a
> code change; it is operational configuration the human applies at deploy time.

## Required environment configuration

### D2 — manage-token signing key (REQUIRED before ship) 🔒
**Introduced by:** the D2 security fix (`src/lib/booking/manage-tokens.ts`) — `manageTokenKey()`
now **fails closed**: it throws when no signing key is configured instead of using the old
hardcoded fallback (`'fsos-dev-booking-token-key-change-me'`), which was forgeable.

**Action:** set **`BOOKING_TOKEN_KEY`** (preferred) — or the shared **`FSOS_API_SECRET`** /
`SOCIAL_TOKEN_KEY` — to a high-entropy secret in **Vercel Production** (and any Preview
environment that serves real booking links) **before this ships.**

**If unset in production:** signed reschedule/cancel links cannot be signed or verified —
- `/api/public/booking/manage` verification throws → route returns 500 (fail-closed; nothing
  forgeable — this is the intended safe failure, not silent verification against a guessable key);
- confirmation email link-building throws but is caught best-effort in `book.ts` (booking creation
  is **not** affected; it falls through to the transactional fallback);
- the booking-reminders cron surfaces a 500 until the key is set.

**Rollback:** this is config, not code — setting the env var resolves it immediately with no
redeploy of application logic required. Do **not** reintroduce a hardcoded fallback.

## Phase rollback levers
- **P1 (public UI):** presentation-only, no migration; revert the P1 commits to restore the prior
  `/schedule` UI. No data or contract impact.
- **P5 (notification automation):** SMS remains behind an explicit feature flag; disabling the flag
  is the immediate rollback (see the P5 plan when authored).
