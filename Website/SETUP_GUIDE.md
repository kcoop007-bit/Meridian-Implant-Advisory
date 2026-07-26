# Setup Guide (plain-English, click by click)

Three tasks. **Only Task 1 is needed right now.** Tasks 2 and 3 can wait until we turn on the reminder and booking features — do them whenever you're ready.

No coding required for any of this. If you get stuck on any step, tell me what you see on screen and I'll get you unstuck.

---

## TASK 1 — Turn on the new resource features (do this now) ⏱ ~5 min

This has two parts: (A) update the database, then (B) re-publish the site.

### Part A — Run the database update in Supabase
1. Go to **https://supabase.com** and click **Sign in** (top right). Log in with the account you used before.
2. On the dashboard you'll see your project (its name is under "Projects"). **Click it.**
3. On the **left sidebar**, find and click the icon labeled **SQL Editor** (it looks like a small database/terminal symbol; hovering shows the name).
4. Click the green **+ New query** button (top left of that panel).
5. Now open the file **`supabase-schema-v2.sql`** — it's in your `Meridian Implant Advisory/Website` folder. Double-click to open it in TextEdit (or any text app).
6. Select everything in that file: click inside it, then press **Cmd + A** (selects all), then **Cmd + C** (copies).
7. Back in Supabase, click inside the big empty query box and press **Cmd + V** (pastes).
8. Click the green **Run** button (bottom right of the query box), or press **Cmd + Enter**.
9. You should see **"Success. No rows returned"** at the bottom. That's the win — it means the update worked. (If you see a red error, copy the message to me and I'll fix it — it won't have broken anything.)

*(This is safe to run once. It only adds new capabilities; it doesn't touch or delete anything you already have.)*

### Part B — Re-publish the website so the new pages go live
Your site files were updated on your computer; Netlify needs the new copy.

1. Go to **https://app.netlify.com** and **log in**.
2. Click your site in the list (it'll be named for meridianimplantadvisory.com).
3. Click the **Deploys** tab (top menu of the site page).
4. You'll see a box that says **"Drag and drop your site output folder here"** (near the bottom of the Deploys page, or a **"Deploy manually"** area).
5. Open a Finder window, navigate to your **`Meridian Implant Advisory`** folder, and **drag the `Website` folder** onto that drop box.
6. Wait ~30–60 seconds. When it says **"Published,"** you're live. Visit **meridianimplantadvisory.com/resources.html** (log in) to see the new layout.

✅ **After Task 1:** the resource portal shows Staff vs Patient documents, training-module groups, and the pinned Training Booklet; the Specialists page shows the four training modules.

---

## TASK 2 — Brevo (email for the reminder feature) ⏱ ~10 min — *do this later, when we build reminders*

You already created the Brevo account. Two things to grab, plus one optional step for better delivery.

### 2A — Get your Brevo API key
1. Log in at **https://app.brevo.com**.
2. Click your **account name** (top-right corner) → choose **SMTP & API**.
3. Click the **API Keys** tab → **Generate a new API key**.
4. Name it `meridian-reminders` → **Generate** → **copy the key** (a long string starting with `xkeysib-`). Keep it somewhere safe for a moment — you'll paste it into Netlify in step 2C.

### 2B — (Recommended) Verify your domain so reminders don't land in spam
1. In Brevo, top-right account menu → **Senders, Domains & Dedicated IPs** → **Domains** tab → **Add a domain**.
2. Type **meridianimplantadvisory.com** → Brevo shows you **3–4 DNS records** (rows of text labeled DKIM / SPF / DMARC).
3. Your DNS is managed at **Cloudflare** (not Netlify — confirmed by your nameservers). Open a second browser tab → **https://dash.cloudflare.com** → click your domain → left sidebar **DNS → Records** → **+ Add record**, and copy each Brevo record across:
   - **Type** = match Brevo (TXT or CNAME). **Name** = Brevo's host (paste the front part if it's long; Cloudflare appends the domain). **Content/Target** = Brevo's value.
   - If the record is a **CNAME**, set **Proxy status** to **DNS only** (click the orange cloud so it turns grey). TXT records have no cloud.
   - **Save**, repeat for all records.
4. Back in Brevo, click **Verify / Authenticate**. (DNS can take a few minutes to an hour to go green — that's normal.)
   *You can skip 2B to start; reminders will still send, just with slightly higher spam risk.*

### 2C — Put the keys into Netlify (where the reminder function reads them)
1. **Netlify → your site → Site configuration** (or **Site settings**) → **Environment variables** → **Add a variable**.
2. Add these three (I'll tell you exactly when S5 is built):
   - **Key:** `BREVO_API_KEY` **Value:** the `xkeysib-…` key from 2A
   - **Key:** `SUPABASE_URL` **Value:** `https://zesnsbxkiteqzggkckyz.supabase.co`
   - **Key:** `SUPABASE_SERVICE_ROLE_KEY` **Value:** *(from Supabase → Project Settings → API → "service_role" secret key — this one is private, never put it in the website files; only here)*
3. Click **Save**. Done — the reminder function will find these automatically.

---

## TASK 3 — Calendly (the booking calendar) ⏱ ~15 min — *do this when you want booking live*

### 3A — Connect your calendars (so it grays out conflicts)
1. Log in at **https://calendly.com**.
2. Top-right avatar → **Account settings** → **Calendar connections** (or **Connected calendars**).
3. Connect **both**: your **Outlook / Exchange** account and your **Google (Gmail)** account. Calendly will then automatically block any time you're already busy on either.

### 3B — Create one "event type" per kind of appointment
For each type you offer, do this:
1. On the Calendly home screen click **+ Create** → **Event Type** → **One-on-One**.
2. Give it a name and length, e.g.:
   - **Discovery Call** — 30 min
   - **Training Session** — 60 min
   - **In-Service** — 60 min
   - (add any others you want)
3. Set the days/times you're available for that type → **Save**.
4. On the event's page, click **Copy link** — you'll get a link like `https://calendly.com/your-name/discovery-call`.

### 3C — Send me the links + your time blocks
Paste me:
- Each **event link** from 3B, and
- The **list of appointment types** with their **durations and the days/time windows** you want offered.

Then I'll embed them into a booking page on your site so clients pick the type and see live availability — no more back-and-forth emails.

---

### Quick recap
- **Now:** Task 1 (5 min) → new resource pages go live.
- **Later, when we build reminders:** Task 2.
- **When you want online booking:** Task 3 (and send me the Calendly links).

---

## GO-LIVE CHECKLIST — Feature release (S1–S7)

Everything is coded and tested. To turn it all on:

1. **Run the two new migrations** (same steps as Task 1, Part A):
   - `supabase-schema-v2.sql` — *(already run ✅)*
   - `supabase-schema-v3.sql` — adds the Goals/KPI tables + reminder email field. Paste → Run.
2. **Deploy** — auto-deploys when the updated `Website` files reach your connected repo (or drag the folder onto Netlify → Deploys).
3. **Reminders (S5) — set 3 Netlify environment variables** (Netlify → Site configuration → Environment variables):
   - `SUPABASE_URL` = `https://zesnsbxkiteqzggkckyz.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = *(Supabase → Project Settings → API → service_role secret — private!)*
   - `BREVO_API_KEY` = *(Brevo → SMTP & API → API Keys)*
   - Optional: `REMINDER_FROM_EMAIL` (default `reminders@meridianimplantadvisory.com`).
   The dispatcher (`netlify/functions/reminder-dispatch.mjs`) runs hourly automatically once deployed.
4. **Booking (S3)** — no SQL needed: log in as admin → **Book a Session** page → "Add a session type," paste your **Calendly event links**. They appear for clients immediately.
5. **New account pages** are linked from the "Your Account" nav bar: Resources · Goals & KPIs · Reminders · Book a Session. Admins also get **Manage user access** and **View goals** (per client) from the admin page.

Nothing here costs anything on current usage (Supabase free, Netlify free, Brevo free).

Stuck anywhere? Screenshot or describe what you see and I'll walk you through it.
