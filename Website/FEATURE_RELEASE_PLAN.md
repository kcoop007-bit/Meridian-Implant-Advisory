# Feature Release — Architecture Blueprint (confirm before coding)

Principal-architect plan for the 5 streams. Grounded in the **actual stack**: static HTML/CSS/vanilla-JS front end + **Supabase** (Postgres + Auth + Row-Level Security + Storage) + Eventbrite. There is no custom application server, so all "backend" work is Supabase **tables + RLS policies + Edge Functions** (Deno), scheduled with **pg_cron**. This blueprint exists so we lock schemas/paths/ownership *before* writing code and avoid the merge conflicts the parallel streams could otherwise cause.

## Why we confirm first (shared surfaces = conflict risk)
The five streams are *not* fully independent — three of them touch the same three things:
- **`profiles` table** — Streams 1 (privileges) and 2 (onboarding) both extend it.
- **`resources` table + `js/resources.js` + `resources.html`** — Streams 1 (revocation gating) and 4 (staff/patient/module restructure) both touch these.
- **One `supabase-schema.sql`** — every stream adds tables/policies to it.

If five agents each rewrite `resources.js` or append conflicting migrations, we get exactly the overwrite/merge mess to avoid. Solution below: **one consolidated additive migration**, a **file-ownership matrix** (no two streams edit the same file), and a **build order**.

---

## Consolidated migration (single source of truth)
New file `supabase-schema-v2.sql` — **additive only**, never rewrites v1. Sectioned by stream so edits don't collide:

- **S1** `entitlements` table (`user_id`, `resource_scope`, `granted boolean`, `revoked_at`) + `has_access(scope)` SECURITY DEFINER helper; RLS on `resources`/storage reads it live so revocation is instant.
- **S2** `onboarding_responses` (typed columns for goals, bottlenecks, staff structure, prior systems + a `raw jsonb`), `waiver_acceptances` (immutable: `user_id`, `waiver_version`, `accepted_at`, `ip`, `user_agent`).
- **S3** `booking_types`, `calendar_connections` (provider enum, encrypted OAuth token refs), `bookings`, `availability_cache`.
- **S4** extend `resources`: `audience text check (staff|patient|null)`, `module text`, `pinned boolean default false`; backfill existing rows.
- **S5** `reminders` (owner, channel, `schedule_cron`, `recurrence`, `next_run_at`, `active`), `reminder_log`.

RLS pattern reuses the existing `is_admin()` / SECURITY-DEFINER approach already in v1.

---

## File-ownership matrix (prevents overwrites)
| Stream | Owns (create/edit) | May only APPEND to (coordinated) |
|---|---|---|
| S1 Access control | `admin.html`, `js/admin.js` | `supabase-schema-v2.sql` §S1 |
| S2 Onboarding | `onboarding.html`, `js/onboarding.js`, `partials/waiver.html` | §S2 |
| S3 Booking | `booking.html`, `js/booking.js`, `supabase/functions/calendar-*` | §S3 |
| S4 Resources refactor | `resources.html`, `js/resources.js`, `specialists.html` | §S4 |
| S5 Reminders | `reminders.html`, `js/reminders.js`, `supabase/functions/reminder-dispatch` | §S5 |
| Shared (I own, done first) | `supabase-schema-v2.sql`, `partials/header.html` (nav links) | — |

Only **S1 and S4 both care about `resources.js`**. Resolution: **S4 owns `resources.js`** (it's a bigger rewrite of the grouping/rendering); S1 does its gating purely in **RLS + `has_access()`** so the browse view needs no S1 edits. No file is edited by two streams.

---

## Per-stream design

### S1 — Revoke resource privileges (fully doable)
- **Model:** per-user entitlements row(s); "revoke" flips `granted=false`/sets `revoked_at`. `resources` + storage RLS call `has_access()` → next request is blocked instantly (no session invalidation needed; RLS is evaluated per query).
- **UI:** `admin.html` privilege toggles per user (admins only, gated by `is_admin()`).
- **Tests:** SQL/pgTAP or JS unit tests for `has_access()` truth table (granted / revoked / admin-override / expired).

### S2 — Onboarding + mandatory waiver (fully doable)
- Multi-step questionnaire → writes `onboarding_responses`. Waiver = checkbox + scrollable text block; **submit disabled until accepted**; acceptance logged immutably (version + timestamp). Waiver text sourced from your approved `legal_disclaimer_updated.md` once counsel signs off.
- Payload maps to typed columns so future implementations can query practice metrics.

### S3 — Multi-calendar sync booking engine (LARGE — needs decisions/credentials)
This is the one that isn't a "drop-in PR." A static site can't sync calendars; it requires OAuth apps, stored secrets, and always-running workers (Supabase Edge Functions + pg_cron). Specifics:
- **Google** = Google Calendar API + OAuth (Google Cloud project, consent screen, possibly verification).
- **Apple iCloud** = CalDAV + a user **app-specific password** (no OAuth); bidirectional write is limited/fragile.
- **"BioHorizons calendar"** = needs identification — almost certainly **Microsoft 365 / Outlook (Exchange)** → Microsoft Graph API, not a BioHorizons-specific API. **Confirm.**
- **Availability engine:** pull busy blocks from all connected calendars → gray out conflicting slots on the site. Booking types (discovery/training/in-service…) come from **the list + time blocks you said you'll provide** — S3 is *blocked* on that.
- **Recommendation:** phase it — (3a) one-way *availability read* + on-site booking that emails an ICS invite, then (3b) full bi-directional write-back per provider. Trying to one-shot bi-directional 3-provider sync will not be reliable or testable here.

### S4 — Resources + Specialist page restructure (fully doable, mostly frontend)
- Split resource area into **Staff Documents** / **Patient Documents** (new `audience` column). General Training grouped by `module`; **"Training Booklet" module pinned to top** (`pinned` + sort).
- Specialist page sub-sections: Scanning for Referrals, Photogrammetry, Study Clubs, Referral Development Programs, each with `.pptx` placeholder/download blocks.

### S5 — Reminder engine (doable; needs an email provider)
- `reminders` + **pg_cron**-triggered Edge Function `reminder-dispatch` → sends email (needs **Resend or SendGrid** account/API key) and/or a calendar entry (ICS invite works anywhere; writing into their Google/Apple reuses S3's OAuth).
- Recurrence config (e.g., bi-annual fishing-letter alert). Dashboard `reminders.html` to add/edit/delete.

---

## Build order (dependency-aware)
1. **Shared migration + nav** (me) → unblocks everyone.
2. **S1, S2, S4** in parallel (frontend + RLS, no external creds) — isolated new files per the matrix.
3. **S5** (needs email provider key).
4. **S3** last / phased (needs OAuth apps, Apple password, BioHorizons identification, and your booking-type list).

## Isolation mechanism
Each stream on its own **git branch/worktree** (`feat/s1-access`, `feat/s2-onboarding`, …) so nothing overwrites `main`; merged in build order. The truly independent new-file streams (S2, S5 dashboard, S3 functions) can run as parallel sub-agents in separate worktrees; the shared-file work (schema, resources.js) I keep coherent centrally.

---

## Confirmed decisions (locked 2026-07-24)
1. **Server runtime → Netlify.** Use **Netlify Functions** (serverless) + **Netlify Scheduled Functions** (cron) for S5 dispatch and any S3 server needs. Secrets (Resend key, Supabase service_role, any OAuth) live in **Netlify environment variables**, never in the repo.
2. **Credentials found in repo:** Supabase URL `https://zesnsbxkiteqzggkckyz.supabase.co` + anon/publishable key (safe, client-side) and Eventbrite org URL are present. Email/OAuth/service_role secrets are **not** in the repo (correct — they go in Netlify env). Delivery model: **PR-ready code**; migration run by Kevin in Supabase SQL editor; functions deploy via Netlify with env vars set.
3. **Stream 3 → Calendly.** iPhone = Exchange, BioHorizons = Outlook, Calendly-for-Outlook available. Use **Calendly embedded inline** as the booking engine (it already syncs Outlook/Exchange + Google and grays out conflicts). Booking types map to Calendly event types. Custom OAuth sync deferred unless Calendly proves insufficient. Still needed from Kevin: the **list of booking types + time blocks** and the Calendly account/event-type links.
4. **Stream 5 email → Resend** (pluggable adapter). API key set as `RESEND_API_KEY` in Netlify env.
5. **Waiver source → `legal_disclaimer_updated.md`** (pending counsel sign-off) feeds the S2 waiver text block.

### S5 recurrence spec (from Kevin)
Client account page: **add / delete / toggle on-off** per reminder. Presets, all defaulting to **07:00 America/New_York**: **daily** (selected weekdays), **weekly** (Mon), **monthly** (1st), **quarterly** (1st of Jan/Apr/Jul/Oct), **bi-annual** (Jan 1 & Jul 1). Built-in use cases: **Goals & KPI review** (any cadence) and **Marketing channels** (e.g., quarterly "send out fishing letters"). Every reminder's **day/time/recurrence is customizable**. Times stored with timezone; cron computed in UTC accounting for EST/EDT.
