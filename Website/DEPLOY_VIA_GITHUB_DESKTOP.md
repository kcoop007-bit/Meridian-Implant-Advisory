# Publishing the website with GitHub Desktop (one-time setup)

You only do the full sequence **once**. After that, every future update I make is just:
**GitHub Desktop → Commit → Push → it auto-publishes.** (~2 clicks.)

I've already done the safety prep on your computer:
- Added a `.gitignore` so **only the `Website` folder** ever goes to GitHub — your booklet PDFs, Legal, Logo, and other private files stay off the internet.
- Cleared a stuck Git file that would have blocked committing.
- Verified: exactly 39 website files will be published; nothing private.

Do the steps **in this order** so the live site never goes dark.

---

## STEP 1 — Netlify: point it at the Website folder (do this FIRST) ⏱ ~2 min

1. Go to **https://app.netlify.com** and log in.
2. Click your site (the meridianimplantadvisory.com one).
3. Top menu: **Site configuration** (or **Site settings**).
4. Left sidebar: **Build & deploy** → **Build settings** → click **Edit**.
5. In **Base directory**, type:  `Website`
6. Leave everything else as-is. Click **Save**.

*(A deploy may kick off and fail — that's fine and expected, because the new files aren't on GitHub yet. Your current live site stays up. Step 3 fixes it.)*

---

## STEP 2 — GitHub Desktop: add the project ⏱ ~1 min

1. Open **GitHub Desktop**.
2. Menu bar: **File → Add Local Repository…**
3. Click **Choose…**, and select this folder:
   **Desktop → Claude Projects → Meridian Implant Advisory**
4. Click **Add Repository**.

You'll now see a list of changes on the left. It should show:
- **`.gitignore`** (new)
- a **`Website`** folder full of files (the new pages)
- some files marked as removed (the old copies that moved into Website) — this is correct.

You should **NOT** see Legal, Logo, Client Development, or PDFs in that list. If you do, stop and tell me.

---

## STEP 3 — Commit & push ⏱ ~1 min

1. Bottom-left, in the **Summary** box, type:
   `Publish website feature release (accounts, goals, reminders, booking)`
2. Click the blue **Commit to main** button.
3. Top of the window, click **Push origin** (or **Publish branch** if that's what shows).

That's it — Netlify sees the push and rebuilds automatically. Give it ~1–2 minutes.

---

## STEP 4 — Confirm it's live ⏱ ~2 min

1. Visit **https://meridianimplantadvisory.com/login.html** — you should now see the **Forgot password?** link.
2. Log in and check the account nav: **Resources · Goals & KPIs · Reminders · Book a Session**.

If anything looks off, screenshot it and I'll sort it out.

---

## After this is done — the ongoing flow

From now on, whenever I make website changes and you approve them:
1. Open **GitHub Desktop** (it remembers the project).
2. Type a short summary → **Commit to main** → **Push origin**.
3. Live in ~2 minutes.

No drag-and-drop, no Netlify steps needed again.

---

## Still remaining to fully switch everything on (separate from deploy)
- **Run `supabase-schema-v3.sql`** in Supabase (adds Goals + reminder email field) — same paste-and-Run steps as before.
- **Set 3 Netlify environment variables** for reminders: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY`.
- **Add your Calendly event links** on the Book a Session page (admin view).

See `SETUP_GUIDE.md` (GO-LIVE CHECKLIST) for the exact clicks on those three.
