-- Meridian Implant Advisory — schema v5: Gold session scheduling
-- Run this in the Supabase SQL editor (after v4). Safe to re-run.
--
-- Stores each Gold client's six booked implementation sessions. Rows are
-- written by the server-side booking function (service role, bypasses RLS);
-- clients read only their own, admins read all.

create table if not exists public.client_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  session_number int  not null check (session_number between 1 and 6),
  title          text not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  duration_min   int  not null,
  gcal_event_id  text,                          -- Google Calendar event id (for later reschedule/cancel)
  status         text not null default 'booked' -- booked | rescheduled | cancelled | completed
                 check (status in ('booked','rescheduled','cancelled','completed')),
  created_at     timestamptz not null default now(),
  unique (user_id, session_number)
);

create index if not exists client_sessions_user_idx  on public.client_sessions (user_id);
create index if not exists client_sessions_start_idx on public.client_sessions (starts_at);

alter table public.client_sessions enable row level security;

-- Client can read their own booked sessions
drop policy if exists client_sessions_select_own on public.client_sessions;
create policy client_sessions_select_own on public.client_sessions
  for select using (auth.uid() = user_id);

-- Admins can read everyone's
drop policy if exists client_sessions_select_admin on public.client_sessions;
create policy client_sessions_select_admin on public.client_sessions
  for select using (public.is_admin());

-- No client-side insert/update/delete: the booking Netlify function uses the
-- service-role key (which bypasses RLS), so we intentionally grant no write
-- policy to authenticated users. This keeps booking logic server-authoritative.
