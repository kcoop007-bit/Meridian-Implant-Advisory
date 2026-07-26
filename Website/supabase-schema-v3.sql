-- ===================================================================
-- Meridian Implant Advisory — Schema v3
-- ADDITIVE. Run AFTER supabase-schema.sql and supabase-schema-v2.sql.
-- Adds: reminder target email (S5) + the Goals / KPI tracker (S7).
-- ===================================================================

-- ---------- S5: where a reminder is delivered ----------
alter table public.reminders
  add column if not exists target_email text;   -- defaults to the user's login email if null

-- ---------- S7: Goals & KPI tracker ----------
-- One row per tracked goal/KPI. progress % is computed in the UI from
-- baseline/target/current so historical rows stay simple.
create table if not exists public.goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  period     text not null check (period in ('daily','weekly','monthly','quarterly','yearly')),
  name       text not null,                 -- the goal / KPI name
  baseline   numeric,                       -- starting value
  target     numeric,                       -- goal value
  current    numeric,                       -- latest value (progress)
  unit       text,                          -- optional, e.g. "%", "cases", "$"
  notes      text,                          -- why it was / wasn't achieved
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.goals enable row level security;

drop policy if exists "user manages own goals" on public.goals;
create policy "user manages own goals" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admins read all goals" on public.goals;
create policy "admins read all goals" on public.goals
  for select using (public.is_admin());

create index if not exists goals_user_period_idx on public.goals (user_id, period);

-- ===================================================================
-- Done.  (Reminder dispatcher reads target_email; Goals page + admin
-- read/write public.goals under the RLS above.)
-- ===================================================================
