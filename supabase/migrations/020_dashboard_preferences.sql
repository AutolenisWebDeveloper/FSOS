-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Per-user dashboard preferences
-- Migration: 020_dashboard_preferences
--
-- Persists each user's PERSONAL home-dashboard arrangement so the layout they
-- configure once is restored on every login and never changes until they change
-- it. This is distinct from the shared `dashboards` table (014) which holds NAMED
-- custom dashboards; this table holds exactly one row per user for the main
-- /app dashboard grid.
--
--   layout = ordered array of placed widgets:
--     [{ "key": "open_opportunities", "x": 0, "y": 0, "w": 3, "h": 2, "visible": true }, ...]
--   Each key resolves to a real, DB-derived metric (lib/analytics/metrics.ts) so a
--   saved layout can never drift from the data — the layout only pins WHICH widgets
--   are shown and WHERE/HOW BIG, never any figure.
--
-- No guardrail is affected: this is an internal read-surface preference only. No
-- client-facing send path touches it; it stores no PII, money, or securities data.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists dashboard_preferences (
  user_id     text primary key,                 -- SessionClaims.userId (auth user id)
  layout      jsonb not null default '[]',       -- [{key,x,y,w,h,visible}, ...]
  updated_at  timestamptz not null default now()
);

comment on table dashboard_preferences is
  'Per-user personal home-dashboard widget layout (position/size/visibility). One row per user.';

-- RLS is defense-in-depth: internal API routes read/write with the service role
-- (getDb) and scope every query by the authenticated user id, but if a future
-- surface ever uses the anon/user client, a user may only touch their own row.
alter table dashboard_preferences enable row level security;

drop policy if exists dashboard_preferences_self on dashboard_preferences;
create policy dashboard_preferences_self
  on dashboard_preferences
  for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);
