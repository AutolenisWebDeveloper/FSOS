-- ═══════════════════════════════════════════════════════════════════
-- FSOS — Tasks & follow-up reminders
-- Migration: 005_tasks
-- Run in: Supabase → SQL Editor → New Query → paste → Run
--
-- Backs the Follow-Ups screen: a lightweight task list the agent works from
-- (today / overdue / upcoming), plus tasks auto-created from the renewal &
-- anniversary tracker. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists tasks (
  task_id      uuid primary key default gen_random_uuid(),
  title        text not null,
  notes        text,
  customer_id  uuid references customers(customer_id) on delete cascade,
  agency_id    text references agencies(agency_id) on delete set null,
  due_date     date,
  priority     text default 'medium',   -- low|medium|high
  status       text default 'open',     -- open|done|snoozed
  source       text default 'manual',   -- manual|ai|auto|renewal
  created_by   text,
  completed_at timestamptz,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists idx_tasks_status   on tasks(status);
create index if not exists idx_tasks_due       on tasks(due_date) where status = 'open';
create index if not exists idx_tasks_customer  on tasks(customer_id);
create index if not exists idx_tasks_agency    on tasks(agency_id);

-- Keep updated_at fresh on any change.
create or replace function tasks_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tasks_touch on tasks;
create trigger trg_tasks_touch before update on tasks
  for each row execute function tasks_touch_updated_at();

-- Written only by the service-role API routes; enable RLS with no permissive
-- policy so the anon/browser key can never read or write the task list.
alter table tasks enable row level security;
