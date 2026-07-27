-- ===================================================================
-- Meridian Implant Advisory — Schema v4
-- ADDITIVE. Run after schema.sql, v2, v3.
-- Adds: membership tier on profiles + a memberships (purchase) record,
-- for the automated Stripe -> onboarding -> account-creation flow.
-- ===================================================================

-- Which tier a client is on. Set automatically by the create-client
-- Netlify function from the verified Stripe payment.
alter table public.profiles
  add column if not exists membership_tier text
    check (membership_tier in ('bronze','silver','gold'));

-- One row per completed purchase (idempotent on the Stripe session id).
create table if not exists public.memberships (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users(id) on delete cascade,
  tier               text check (tier in ('bronze','silver','gold')),
  stripe_session_id  text unique,
  stripe_customer    text,
  amount_total       integer,        -- cents, first charge
  created_at         timestamptz default now()
);

alter table public.memberships enable row level security;

-- A client can see their own membership; admins can see all.
-- (All WRITES happen server-side via the service-role key, which bypasses RLS.)
drop policy if exists "user reads own membership" on public.memberships;
create policy "user reads own membership" on public.memberships
  for select using (auth.uid() = user_id);

drop policy if exists "admins read memberships" on public.memberships;
create policy "admins read memberships" on public.memberships
  for select using (public.is_admin());

-- ===================================================================
-- Done. The Netlify functions verify-session + create-client use the
-- SUPABASE_SERVICE_ROLE_KEY to insert here and to create the auth user.
-- ===================================================================
