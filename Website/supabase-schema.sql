-- ===================================================================
-- Meridian Implant Advisory — Supabase setup
-- Run this once in your Supabase project's SQL Editor (Dashboard ->
-- SQL Editor -> New Query -> paste this whole file -> Run).
-- ===================================================================

-- ---------- profiles ----------
-- One row per user, linked 1:1 to Supabase's built-in auth.users table.
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  full_name text,
  practice_name text,
  role text not null default 'client' check (role in ('admin','client')),
  client_type text check (client_type in ('gp','specialist')),
  created_at timestamptz default now()
);

-- Auto-create a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- resources ----------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  file_path text not null,
  category text not null check (category in ('gp','specialist','general')),
  uploaded_at timestamptz default now()
);

-- ---------- leads (contact form submissions) ----------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  practice text,
  email text,
  role text,
  message text,
  created_at timestamptz default now()
);

-- ===================================================================
-- Row Level Security
-- ===================================================================
alter table public.profiles enable row level security;
alter table public.resources enable row level security;
alter table public.leads enable row level security;

-- Helper: is the current user an admin? SECURITY DEFINER means this
-- function reads public.profiles with elevated privileges, bypassing
-- RLS internally -- which is what avoids the infinite-recursion trap
-- you'd get from a policy on `profiles` querying `profiles` directly.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- profiles: a user can read their own profile
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

-- profiles: admins can read every profile
drop policy if exists "admins read all profiles" on public.profiles;
create policy "admins read all profiles" on public.profiles
  for select using (public.is_admin());

-- resources: any signed-in user can view the list
drop policy if exists "authenticated read resources" on public.resources;
create policy "authenticated read resources" on public.resources
  for select using (auth.role() = 'authenticated');

-- resources: only admins can add / remove
drop policy if exists "admins insert resources" on public.resources;
create policy "admins insert resources" on public.resources
  for insert with check (public.is_admin());

drop policy if exists "admins delete resources" on public.resources;
create policy "admins delete resources" on public.resources
  for delete using (public.is_admin());

-- leads: anyone (even logged-out visitors) can submit the contact form
drop policy if exists "anyone can submit a lead" on public.leads;
create policy "anyone can submit a lead" on public.leads
  for insert with check (true);
-- (no select policy for the public anon/authenticated roles -- you'll
-- read leads from the Supabase dashboard's Table Editor as yourself)

-- ===================================================================
-- Storage: create the "resources" bucket and its policies
-- ===================================================================
insert into storage.buckets (id, name, public)
values ('resources', 'resources', false)
on conflict (id) do nothing;

drop policy if exists "authenticated read resource files" on storage.objects;
create policy "authenticated read resource files" on storage.objects
  for select using (bucket_id = 'resources' and auth.role() = 'authenticated');

drop policy if exists "admins upload resource files" on storage.objects;
create policy "admins upload resource files" on storage.objects
  for insert with check (bucket_id = 'resources' and public.is_admin());

drop policy if exists "admins delete resource files" on storage.objects;
create policy "admins delete resource files" on storage.objects
  for delete using (bucket_id = 'resources' and public.is_admin());

-- ===================================================================
-- After running this once:
-- 1. Create your own login: Supabase Dashboard -> Authentication ->
--    Users -> Add User (use your real email). Note the user's UUID.
-- 2. Make yourself admin: in SQL Editor, run
--      update public.profiles set role = 'admin' where email = 'you@example.com';
-- 3. To add a client later: Add User the same way, then optionally
--      update public.profiles set client_type = 'gp' where email = 'client@example.com';
--    (role stays 'client' by default -- only you should be 'admin')
-- ===================================================================
