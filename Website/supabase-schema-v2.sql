-- ===================================================================
-- Meridian Implant Advisory — Schema v2 (Feature Release)
-- ADDITIVE migration. Run AFTER supabase-schema.sql, once, in the
-- Supabase SQL Editor (Dashboard -> SQL Editor -> New Query -> paste
-- -> Run). It never rewrites v1 tables; it only adds to them.
--
-- Streams:  S1 access control · S2 onboarding+waiver · S3 booking
--           · S4 resources restructure · S5 reminders
-- Reuses the v1 is_admin() SECURITY DEFINER helper for admin gates.
-- ===================================================================

-- =====================================================================
-- S1 — USER ACCESS CONTROL (revoke resource privileges)
-- =====================================================================
-- Account-level kill switch on the existing profiles table.
alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- Per-user, per-scope entitlement overrides. Model: DEFAULT ALLOW,
-- explicit DENY. A row with granted=false REVOKES access to that scope,
-- so existing users keep working until an admin revokes something.
-- scope ∈ resource category ('gp','specialist','general'), a module
-- name, or 'all' (revokes the whole library for that user).
create table if not exists public.entitlements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  scope       text not null,
  granted     boolean not null default true,
  revoked_at  timestamptz,
  updated_at  timestamptz default now(),
  unique (user_id, scope)
);

-- Live access check used by RLS. Admin always passes. A user is blocked
-- if their account is inactive, or if a DENY row exists for this scope
-- (or a global 'all' DENY). Because RLS evaluates this per query, an
-- admin revocation takes effect on the user's very next request.
create or replace function public.has_access(p_scope text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_admin()
    or (
      coalesce((select is_active from public.profiles where id = auth.uid()), true)
      and not exists (
        select 1 from public.entitlements e
        where e.user_id = auth.uid()
          and e.granted = false
          and e.revoked_at is not null
          and e.scope in (p_scope, 'all')
      )
    );
$$;

alter table public.entitlements enable row level security;

drop policy if exists "user reads own entitlements" on public.entitlements;
create policy "user reads own entitlements" on public.entitlements
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "admins manage entitlements" on public.entitlements;
create policy "admins manage entitlements" on public.entitlements
  for all using (public.is_admin()) with check (public.is_admin());

-- Admins need to read every profile row to drive the toggle UI (v1 only
-- had "read own" + "admins read all" for select; add update for admins).
drop policy if exists "admins update profiles" on public.profiles;
create policy "admins update profiles" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- Tighten resource visibility to honor revocation. Replaces v1's
-- "authenticated read resources" (which allowed any signed-in user).
drop policy if exists "authenticated read resources" on public.resources;
drop policy if exists "entitled read resources" on public.resources;
create policy "entitled read resources" on public.resources
  for select using (
    auth.role() = 'authenticated'
    and public.has_access(category)
  );

-- Same gate on the file bytes in storage. (Files are keyed by path, not
-- category, so this enforces the account-level switch + global 'all'
-- revoke; per-category file gating stays at the row/list level above.)
drop policy if exists "authenticated read resource files" on storage.objects;
drop policy if exists "entitled read resource files" on storage.objects;
create policy "entitled read resource files" on storage.objects
  for select using (
    bucket_id = 'resources'
    and auth.role() = 'authenticated'
    and public.has_access('all')
  );

-- =====================================================================
-- S2 — ONBOARDING QUESTIONNAIRE + MANDATORY WAIVER
-- =====================================================================
create table if not exists public.onboarding_responses (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  goals                    text,
  bottlenecks              text,
  num_doctors              int,
  has_treatment_coordinator boolean,
  staff_structure          jsonb,     -- roles/counts, flexible
  prior_systems            text,      -- other systems they've tried
  raw                      jsonb,     -- full payload for future fields
  submitted_at             timestamptz default now(),
  updated_at               timestamptz default now()
);

alter table public.onboarding_responses enable row level security;

drop policy if exists "user manages own onboarding" on public.onboarding_responses;
create policy "user manages own onboarding" on public.onboarding_responses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admins read onboarding" on public.onboarding_responses;
create policy "admins read onboarding" on public.onboarding_responses
  for select using (public.is_admin());

-- Immutable acceptance log (one row per acceptance; never updated).
create table if not exists public.waiver_acceptances (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  waiver_version text not null,
  accepted_at    timestamptz default now(),
  ip             text,
  user_agent     text
);

alter table public.waiver_acceptances enable row level security;

drop policy if exists "user inserts own waiver" on public.waiver_acceptances;
create policy "user inserts own waiver" on public.waiver_acceptances
  for insert with check (auth.uid() = user_id);

drop policy if exists "user reads own waiver" on public.waiver_acceptances;
create policy "user reads own waiver" on public.waiver_acceptances
  for select using (auth.uid() = user_id or public.is_admin());
-- (no update/delete policy => acceptances are immutable by design)

-- =====================================================================
-- S3 — BOOKING (Calendly-backed; DB holds config + a local record)
-- =====================================================================
-- Booking types map 1:1 to Calendly event types. calendly_url is the
-- scheduling link for that type; embedded inline on booking.html.
create table if not exists public.booking_types (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,           -- 'discovery', 'training', 'inservice'
  label        text not null,
  description  text,
  duration_min int,
  calendly_url text,                           -- per-type Calendly link
  sort_order   int default 0,
  active       boolean not null default true
);

-- Optional local mirror of confirmed bookings (Calendly webhook can
-- write here later; not required for the embed to work).
create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete set null,
  booking_type_id uuid references public.booking_types(id) on delete set null,
  start_ts        timestamptz,
  end_ts          timestamptz,
  invitee_name    text,
  invitee_email   text,
  status          text default 'confirmed' check (status in ('confirmed','canceled','rescheduled')),
  source          text default 'calendly',
  created_at      timestamptz default now()
);

alter table public.booking_types enable row level security;
alter table public.bookings enable row level security;

drop policy if exists "anyone reads active booking types" on public.booking_types;
create policy "anyone reads active booking types" on public.booking_types
  for select using (active = true or public.is_admin());

drop policy if exists "admins manage booking types" on public.booking_types;
create policy "admins manage booking types" on public.booking_types
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "user reads own bookings" on public.bookings;
create policy "user reads own bookings" on public.bookings
  for select using (auth.uid() = user_id or public.is_admin());

-- =====================================================================
-- S4 — RESOURCES + SPECIALIST PAGE RESTRUCTURE
-- =====================================================================
-- audience splits the library into Staff vs Patient documents.
-- module groups files under a training module. pinned floats a module
-- (the "Training Booklet") to the top. sort_order for manual ordering.
alter table public.resources
  add column if not exists audience   text check (audience in ('staff','patient')),
  add column if not exists module     text,
  add column if not exists pinned     boolean not null default false,
  add column if not exists sort_order int default 0;

-- Seed the pinned Training Booklet module so it renders first even
-- before any file is tagged into it (safe no-op if already present).
-- (Actual files are uploaded via the admin panel and tagged module=
--  'Training Booklet'; this comment documents the convention.)

-- =====================================================================
-- S5 — REMINDER ENGINE
-- =====================================================================
create table if not exists public.reminders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  category      text not null default 'custom'
                  check (category in ('goals_kpi','marketing','custom')),
  channel       text not null default 'email'
                  check (channel in ('email','calendar','both')),
  frequency     text not null
                  check (frequency in ('daily','weekly','monthly','quarterly','biannual','custom')),
  byweekday     int[],                       -- 0=Sun..6=Sat, for daily/weekly
  day_of_month  int,                         -- for monthly/quarterly/biannual (default 1)
  time_local    time not null default '07:00',
  timezone      text not null default 'America/New_York',
  schedule_cron text,                        -- computed UTC cron for the dispatcher
  next_run_at   timestamptz,
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists public.reminder_log (
  id          uuid primary key default gen_random_uuid(),
  reminder_id uuid references public.reminders(id) on delete cascade,
  run_at      timestamptz default now(),
  status      text,                          -- 'sent' | 'error' | 'skipped'
  detail      text
);

alter table public.reminders enable row level security;
alter table public.reminder_log enable row level security;

drop policy if exists "user manages own reminders" on public.reminders;
create policy "user manages own reminders" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admins read reminders" on public.reminders;
create policy "admins read reminders" on public.reminders
  for select using (public.is_admin());

drop policy if exists "user reads own reminder log" on public.reminder_log;
create policy "user reads own reminder log" on public.reminder_log
  for select using (
    public.is_admin()
    or exists (select 1 from public.reminders r
               where r.id = reminder_log.reminder_id and r.user_id = auth.uid())
  );
-- The Netlify scheduled function writes reminders/reminder_log using the
-- service_role key (bypasses RLS), so no insert policy is needed here.

-- ===================================================================
-- Done. Next: set Netlify env vars (RESEND_API_KEY, SUPABASE_SERVICE_ROLE
-- _KEY, SUPABASE_URL) for the S5 dispatcher; add booking_types rows +
-- Calendly links for S3; frontends ship per the file-ownership matrix.
-- ===================================================================
