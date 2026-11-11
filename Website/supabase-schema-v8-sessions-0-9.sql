-- v8 (2026-11-11): client_sessions.session_number must accept 0–9.
--   0     = Onboarding & Portal Walkthrough (booked before Session 1, Gold)
--   1–9   = the nine-session curriculum (replaced the six-session programme 2026-08-04;
--           the v5 constraint was never widened, so Sessions 7–9 failed to save and the
--           whole booking rolled back).
alter table public.client_sessions drop constraint if exists client_sessions_session_number_check;
alter table public.client_sessions add constraint client_sessions_session_number_check
  check (session_number between 0 and 9);
