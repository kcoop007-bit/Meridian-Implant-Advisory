-- ===================================================================
-- v6 — Portal tier gating + KPI baselines
--
-- Two changes:
--   1. Bronze is a book-and-materials tier. It does NOT include the portal
--      resource library. Enforced HERE, in RLS — the JS check in
--      access-logic.js only spares a Bronze client a page of empty shelves;
--      it is not a security boundary.
--   2. KPI baselines are captured once, hard-gated before the tracker opens,
--      and seeded into public.goals so the Quarterly Milestone Tracker's
--      Baseline column has something real in it.
--
-- Safe to re-run.
-- ===================================================================

-- ---------- 1. Practice profile: fields added to onboarding ----------
alter table public.onboarding_responses
  add column if not exists practice_name        text,
  add column if not exists office_address       text,
  add column if not exists office_phone         text,
  add column if not exists website_url          text,
  add column if not exists pms_software         text,   -- Dentrix / Eaglesoft / Open Dental / Curve / other
  add column if not exists active_patient_count int,    -- denominator for the internal-opportunity math
  add column if not exists operatories          int,
  add column if not exists days_open_per_week   numeric,
  add column if not exists num_implant_placers  int,
  add column if not exists implants_placed_last_12mo int,
  add column if not exists has_office_manager   boolean,
  add column if not exists office_manager_name  text,
  add column if not exists office_manager_email text,
  add column if not exists office_manager_cell  text,
  add column if not exists clinician_name       text,
  add column if not exists clinician_email      text,
  add column if not exists clinician_cell       text,
  add column if not exists technology           jsonb,  -- {cbct:bool, scanner:bool, guided:bool, mill:bool}
  add column if not exists refers_implants_out  boolean,
  add column if not exists referral_partners    text,
  add column if not exists team_access          jsonb,  -- [{name,email}] who else needs a login
  add column if not exists preferred_meeting_windows text,
  add column if not exists time_zone            text,
  add column if not exists success_in_6_months  text;   -- "what does success look like?"

-- ---------- 2. Baseline completion flag ----------
alter table public.profiles
  add column if not exists baselines_completed_at timestamptz;

-- ---------- 3. The baseline capture itself ----------
-- One row per client. Nulls are meaningful: null = "we don't track this yet",
-- which is a real and common answer. Storing 0 instead would poison every
-- percentage the dashboard computes later, so the form must never coerce.
create table if not exists public.kpi_baselines (
  user_id                 uuid primary key references auth.users(id) on delete cascade,

  -- Retrospective: sitting in the PMS today, so uncontaminated by training.
  implants_placed_12mo    numeric,
  implants_placed_last_mo numeric,
  consults_last_mo        numeric,
  cases_accepted_last_mo  numeric,
  full_arch_cases_12mo    numeric,
  referred_out_per_mo     numeric,
  implant_revenue_per_mo  numeric,
  avg_case_value          numeric,
  fee_single_low          numeric,
  fee_single_high         numeric,
  fee_arch_low            numeric,
  fee_arch_high           numeric,
  offers_financing        boolean,
  financing_provider      text,

  -- Forward-only: nobody can produce these retrospectively. They start at the
  -- first measurement rather than being guessed at.
  conversations_last_mo   numeric,
  tracks_funnel_today     jsonb,   -- {conversations:bool, consults:bool, accepted:bool}

  -- Goals -> become the target column on the seeded goals rows.
  target_implants_per_mo  numeric,
  target_acceptance_pct   numeric,
  hard_vision             text,
  win_in_90_days          text,
  biggest_blocker         text,

  raw                     jsonb,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

alter table public.kpi_baselines enable row level security;

drop policy if exists "user manages own baselines" on public.kpi_baselines;
create policy "user manages own baselines" on public.kpi_baselines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admins read all baselines" on public.kpi_baselines;
create policy "admins read all baselines" on public.kpi_baselines
  for select using (public.is_admin());

-- ---------- 4. Portal access is Silver/Gold only ----------
create or replace function public.can_access_portal()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true)
      and (p.role = 'admin' or p.membership_tier in ('silver','gold'))
  );
$$;

-- Resource library: replace the "any logged-in user" read policy.
drop policy if exists "authenticated read resources" on public.resources;
drop policy if exists "portal tiers read resources" on public.resources;
create policy "portal tiers read resources" on public.resources
  for select using (public.can_access_portal());

-- ---------- 5. Seed the tracker from the baselines ----------
-- Runs on insert/update of kpi_baselines. Only creates a goal row where a
-- baseline was actually supplied; a null stays absent rather than becoming 0.
create or replace function public.seed_goals_from_baselines()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  acceptance numeric;
begin
  acceptance := case when coalesce(new.consults_last_mo,0) > 0
                     then round(100.0 * new.cases_accepted_last_mo / new.consults_last_mo, 1)
                     end;

  -- monthly funnel + outcome metrics
  perform public.upsert_goal(new.user_id,'monthly','Conversations opened',      new.conversations_last_mo,   null,                      'per month');
  perform public.upsert_goal(new.user_id,'monthly','Consults booked',           new.consults_last_mo,        null,                      'per month');
  perform public.upsert_goal(new.user_id,'monthly','Cases accepted',            new.cases_accepted_last_mo,  null,                      'per month');
  perform public.upsert_goal(new.user_id,'monthly','Case acceptance rate',      acceptance,                  new.target_acceptance_pct, '%');
  perform public.upsert_goal(new.user_id,'monthly','Implants placed',           new.implants_placed_last_mo, new.target_implants_per_mo,'per month');
  perform public.upsert_goal(new.user_id,'monthly','Implant revenue',           new.implant_revenue_per_mo,  null,                      '$/month');
  perform public.upsert_goal(new.user_id,'monthly','Cases referred out',        new.referred_out_per_mo,     0,                         'per month');

  update public.profiles set baselines_completed_at = now() where id = new.user_id;
  return new;
end $$;

create or replace function public.upsert_goal(
  p_user uuid, p_period text, p_name text, p_baseline numeric, p_target numeric, p_unit text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_baseline is null and p_target is null then return; end if;   -- nothing known: don't invent a row
  insert into public.goals (user_id, period, name, baseline, target, current, unit)
  values (p_user, p_period, p_name, p_baseline, p_target, p_baseline, p_unit)
  on conflict do nothing;
end $$;

drop trigger if exists trg_seed_goals on public.kpi_baselines;
create trigger trg_seed_goals
  after insert or update on public.kpi_baselines
  for each row execute function public.seed_goals_from_baselines();

-- ===================================================================
-- Done.
-- ===================================================================
