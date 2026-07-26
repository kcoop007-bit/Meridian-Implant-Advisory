# Meridian Implant Advisory — Website

## What's here

A plain HTML/CSS/JS site (no build step, no npm needed) — 6 pages:

- `index.html` — Home
- `general-dentists.html` — For General Dentists
- `specialists.html` — For Specialists
- `events.html` — Events (Eventbrite embed)
- `login.html` / `resources.html` — Client portal (Supabase auth + gated document library)

## Preview it locally

```
cd "Meridian Implant Advisory"
python3 -m http.server 8420
```
Then open http://localhost:8420/index.html — any browser works, no install needed.

## Setup checklist (in order)

### 1. Create a free Supabase project
Go to [supabase.com](https://supabase.com) → New Project (free tier is plenty to start).

### 2. Run the database setup
In your Supabase project: **SQL Editor → New Query** → paste the entire contents of `supabase-schema.sql` in this folder → **Run**. This creates the tables, security rules, and the private file-storage bucket the resource library uses.

### 3. Connect the site to your project
In Supabase: **Project Settings → API**. Copy your **Project URL** and **anon public** key (this key is *meant* to be public — it only allows what the security rules from step 2 permit).

Open `js/supabase-config.js` and replace the two placeholder values:
```js
window.MERIDIAN_SUPABASE_URL = "https://your-project-ref.supabase.co";
window.MERIDIAN_SUPABASE_ANON_KEY = "your-anon-public-key";
```

### 4. Create your own admin login
In Supabase: **Authentication → Users → Add User** — use your real email and a password. Then in **SQL Editor**, run:
```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```
Now you can log in at `/login.html` and you'll see the drag-and-drop upload panel. Everyone else who logs in (once you create their account the same way) sees the read-only, download-only view — filtered to "General" resources plus whichever of "For General Dentists" / "For Specialists" matches their `client_type` (set that same way via SQL, e.g. `update public.profiles set client_type = 'gp' where email = '...'`).

### 5. Wire up Events
Get your Eventbrite organizer profile URL (Eventbrite → your account → public organizer profile link, looks like `https://www.eventbrite.com/o/your-name-12345678`). Drop it into `js/eventbrite-config.js`.

### 6. Deploy
Easiest path: [Netlify Drop](https://app.netlify.com/drop) — drag this whole folder onto the page, done, live URL in seconds, free. (Or connect a GitHub repo to Netlify/Vercel if you'd rather have it auto-update on every change — ask and I'll set that up.)

### 7. Point your domain
Once you've purchased your domain, add it in Netlify/Vercel's dashboard under Domain Settings and follow their DNS instructions (usually just a couple of DNS records at your registrar).

## Still needed from you

- A headshot/photo whenever you have one (currently the hero is designed to work without one — dropping a photo in later is a small, easy addition)
- Your Eventbrite organizer URL (step 5 above)
- Any edits to the copy — everything is plain text in the `.html` files, easy to hand-edit, or just tell me what to change
