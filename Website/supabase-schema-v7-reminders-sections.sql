-- ===================================================================
-- v7 — the tail of v6 that was appended after it had already been run.
--
-- If you ran supabase-schema-v6-baselines.sql before sections 6-8 existed, the
-- reminders columns, the resource sections and the GP/specialist targeting are
-- all missing. Symptom: "Could not find the 'agenda' column of 'reminders' in
-- the schema cache" when loading the starter reminders.
--
-- Safe to re-run, and safe to run even if you already have some of it.
-- ===================================================================

-- ---------- 6. Reminder templates: extra columns + yearly cadence ----------
alter table public.reminders
  add column if not exists template_key  text,     -- which starter template this came from
  add column if not exists month_of_year int,      -- for 'yearly'
  add column if not exists goal          text,     -- what the meeting is for
  add column if not exists agenda        jsonb,    -- ordered list of talking points
  add column if not exists docs          jsonb;    -- [{label, href}] active documents needed

-- 'yearly' is a new cadence (annual vision review + the four mailing campaigns).
alter table public.reminders drop constraint if exists reminders_frequency_check;
alter table public.reminders add constraint reminders_frequency_check
  check (frequency in ('daily','weekly','monthly','quarterly','biannual','yearly','custom'));

-- One row per template per user, so re-seeding can never duplicate.
create unique index if not exists reminders_user_template_idx
  on public.reminders (user_id, template_key) where template_key is not null;

-- ---------- 7. Resource sections ----------
-- Four fixed sections on the client resources page, in this order.
alter table public.resources
  add column if not exists section text not null default 'active-documents'
    check (section in ('playbook','active-documents','training','guidance'));

-- Uploads are admin-only. Reads are already limited to Silver/Gold by the
-- portal-tier policy above; these three close the write side, which previously
-- relied on the UI hiding the upload form.
drop policy if exists "admins write resources" on public.resources;
create policy "admins write resources" on public.resources
  for insert with check (public.is_admin());
drop policy if exists "admins update resources" on public.resources;
create policy "admins update resources" on public.resources
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete resources" on public.resources;
create policy "admins delete resources" on public.resources
  for delete using (public.is_admin());

-- ---------- 8. GP vs specialist targeting ----------
alter table public.onboarding_responses
  add column if not exists practice_type text check (practice_type in ('gp','specialist')),
  add column if not exists specialty     text;

-- The resource library is targeted by profiles.client_type. Until now that was
-- only ever set by hand in SQL, so every new client fell through to the general
-- list; onboarding now writes it.
--
-- Filtering was also CLIENT-SIDE ONLY: a specialist could read general-practice
-- rows straight from the API. This policy makes the targeting real.
create or replace function public.can_see_resource_category(cat text)
returns boolean language sql stable security definer set search_path = public as $$
  select cat = 'general' or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or p.client_type = cat)
  );
$$;

drop policy if exists "portal tiers read resources" on public.resources;
create policy "portal tiers read resources" on public.resources
  for select using (
    public.can_access_portal() and public.can_see_resource_category(category)
  );

-- PostgREST caches the schema; without this the new columns can stay invisible
-- to the API for a few minutes even though they exist in the database.
notify pgrst, 'reload schema';
