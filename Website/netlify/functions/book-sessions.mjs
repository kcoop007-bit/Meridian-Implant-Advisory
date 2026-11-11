// POST /.netlify/functions/book-sessions
// Body: { sessions:[{n, startISO}], practiceLabel, address }
// Header: Authorization: Bearer <supabase user access token>
//
// Server-authoritative: re-validates durations, 9–5 ET weekday window, the
// 2–3 week gaps, the lead time, and live conflicts before creating the nine
// Google Calendar events and storing them. Rolls back events if the DB write
// fails. Env: GOOGLE_SA_KEY, GCAL_ID, M365_ICS_FEEDS, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY (confirmation emails),
// optional MERIDIAN_NOTIFY_EMAIL (copy to Kevin), optional MEET_FALLBACK_URL
// (used only if Google refuses to generate a Meet link).
import crypto from "node:crypto";

// ---- config (must mirror js/scheduling-config.js) ----
// The nine sessions. Server-authoritative copy — see the note in
// js/scheduling-config.js. `checks/check_sessions.py` fails if the two drift.
const SESSIONS = [
  // Durations INCLUDE a 30-minute Implementation check-in at the START of Sessions 2-9
  // (questions on prior sessions, implementation, issues) - ruled by Kevin 2026-11-11.
  // Content time = dur - 30 for sessions 2-9; Session 1 has no check-in.
  { n: 1, title: "Purpose, Offer & Your Numbers",           dur: 90  },
  { n: 2, title: "The Biology, and How We Say It",          dur: 210 },
  { n: 3, title: "Finding the Patients You Already Have",   dur: 150 },
  { n: 4, title: "The Consult: Knowing & Presenting",       dur: 210 },
  { n: 5, title: "Money, Coding & Consent",                 dur: 120  },
  { n: 6, title: "Case Selection & Treatment Planning",     dur: 210 },
  { n: 7, title: "Surgery Day: Kit, Guide & Protocol",      dur: 120  },
  { n: 8, title: "Digital Workflow & Restorative",          dur: 150 },
  { n: 9, title: "Keeping It: Peri-Implantitis & Full-Arch", dur: 180 }
];
const GAP_MIN = 14, GAP_MAX = 21, LEAD = 10, WORKSTART = 9, WORKEND = 17, BUFFER = 0;
// Onboarding & Portal Walkthrough — session 0, booked before Session 1 (mirror of
// scheduling-config.js onboardingCall). Video call with owner + office manager.
const ONBOARD = { n: 0, title: "Onboarding & Portal Walkthrough", dur: 60 };
const OB_LEAD = 2, OB_MIN_BEFORE_S1 = 3, OB_MAX_BEFORE_S1 = 14;
const STEPS = [ONBOARD, ...SESSIONS];
// Video steps get a Google Meet link: the onboarding call and the remote sessions.
const VIDEO = new Set([0, 5, 8, 9]);

  // ---- US holidays: never offered or accepted for a session ----
// DUPLICATED, deliberately, in netlify/functions/book-sessions.mjs (the server re-validates).
// Fixed-date holidays also block their weekday "observed" day (Sat -> Fri, Sun -> Mon).
function usHolidaySet(y) {
  var out = {};
function key(t) { var d = new Date(t); return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2); }
function fixed(m, d) { var t = Date.UTC(y, m - 1, d), wd = new Date(t).getUTCDay(); out[key(t)] = 1; if (wd === 6) out[key(t - 864e5)] = 1; if (wd === 0) out[key(t + 864e5)] = 1; }
function nth(m, wd, n) { var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return Date.UTC(y, m - 1, 1 + ((wd - first + 7) % 7) + (n - 1) * 7); }
function last(m, wd) { var t = Date.UTC(y, m, 0), dw = new Date(t).getUTCDay(); return t - ((dw - wd + 7) % 7) * 864e5; }
  fixed(1, 1); fixed(7, 4); fixed(12, 24); fixed(12, 25); fixed(12, 31);   // New Year's, July 4th, Christmas Eve/Day, New Year's Eve
  out[key(last(5, 1))] = 1;                                                // Memorial Day
  out[key(nth(9, 1, 1))] = 1;                                              // Labor Day
  var tg = nth(11, 4, 4); out[key(tg)] = 1; out[key(tg + 864e5)] = 1;      // Thanksgiving + the Friday after
  return out;
}
function isUsHoliday(y, mo, d) {
  var k = y + "-" + ("0" + mo).slice(-2) + "-" + ("0" + d).slice(-2);
  return !!(usHolidaySet(y)[k] || usHolidaySet(y + 1)[k]);
}

const b64url = (b) =>
  Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const json = (o, s) =>
  new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } });

async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const clm = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
  }));
  const input = hdr + "." + clm;
  const signer = crypto.createSign("RSA-SHA256"); signer.update(input); signer.end();
  const sig = b64url(signer.sign(sa.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: input + "." + sig })
  });
  const j = await r.json();
  if (!r.ok) throw new Error("google token: " + JSON.stringify(j));
  return j.access_token;
}
function etOffset(ms) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = {}; f.formatToParts(new Date(ms)).forEach((x) => (p[x.type] = x.value));
  const h = p.hour === "24" ? 0 : +p.hour;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second) - ms) / 60000);
}
function etParts(ms) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = {}; f.formatToParts(new Date(ms)).forEach((x) => (p[x.type] = x.value));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { y: +p.year, mo: +p.month, d: +p.day, hh: p.hour === "24" ? 0 : +p.hour, mm: +p.minute, weekday: wd };
}
function etToUtcMs(y, mo, d, hh, mm) {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  let off = etOffset(guess); let ms = guess - off * 60000;
  const off2 = etOffset(ms); if (off2 !== off) ms = guess - off2 * 60000;
  return ms;
}
function icsToMs(val) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/.exec(val);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], hh = m[4] ? +m[4] : 0, mm = m[5] ? +m[5] : 0, ss = m[6] ? +m[6] : 0;
  if (m[7] === "Z") return Date.UTC(y, mo - 1, d, hh, mm, ss);
  if (!m[4]) return etToUtcMs(y, mo, d, 0, 0);
  return etToUtcMs(y, mo, d, hh, mm);
}
function parseICSBusy(text, fromMs, toMs) {
  const u = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const out = [];
  for (const ev of u.split("BEGIN:VEVENT").slice(1)) {
    const body = ev.split("END:VEVENT")[0];
    const ds = /DTSTART[^:\n]*:([0-9TZ]+)/.exec(body);
    const de = /DTEND[^:\n]*:([0-9TZ]+)/.exec(body);
    if (!ds) continue;
    const s = icsToMs(ds[1]); if (s == null) continue;
    const e = de ? icsToMs(de[1]) : s + 3600000;
    if (e > fromMs && s < toMs) out.push([s, e]);
  }
  return out;
}
async function googleBusy(token, calId, fromISO, toISO) {
  const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: fromISO, timeMax: toISO, items: [{ id: calId }] })
  });
  const j = await r.json(); if (!r.ok) throw new Error("freebusy: " + JSON.stringify(j));
  const cal = j.calendars && j.calendars[calId];
  return ((cal && cal.busy) || []).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
}
async function googleBusyRange(token, calId, fromMs, toMs) {
  const CHUNK = 30 * 864e5;
  let out = [];
  for (let s = fromMs; s < toMs; s += CHUNK) {
    const e = Math.min(s + CHUNK, toMs);
    out = out.concat(await googleBusy(token, calId, new Date(s).toISOString(), new Date(e).toISOString()));
  }
  return out;
}
async function insertEvent(token, calId, ev, withMeet) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;
  const post = async (body, q) => {
    const r = await fetch(url + q, {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j;
  };
  if (!withMeet) return post(ev, "");
  // Ask Google to generate a Meet link. If the calendar/account can't (e.g. a service account
  // writing to a personal calendar), fall back to a plain event + MEET_FALLBACK_URL, never fail.
  try {
    const j = await post({ ...ev, conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }, "?conferenceDataVersion=1");
    j._meet = j.hangoutLink || ((j.conferenceData && j.conferenceData.entryPoints) || []).filter((e) => e.entryPointType === "video").map((e) => e.uri)[0] || null;
    if (j._meet) return j;
    console.error("book-sessions: Meet requested but no link returned");
    return j;
  } catch (e) {
    console.error("book-sessions: Meet creation failed, using fallback:", String((e && e.message) || e));
    const fb = process.env.MEET_FALLBACK_URL || null;
    const j = await post(fb ? { ...ev, location: fb, description: ev.description + "\nVideo link: " + fb } : ev, "");
    j._meet = fb; return j;
  }
}
async function deleteEvent(token, calId, id) {
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${id}`, {
    method: "DELETE", headers: { Authorization: "Bearer " + token }
  });
}

const SB = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function sbUser(userToken) {
  const r = await fetch(SB + "/auth/v1/user", { headers: { apikey: SVC, Authorization: "Bearer " + userToken } });
  if (!r.ok) return null; return r.json();
}
async function sbGet(path) {
  const r = await fetch(SB + "/rest/v1/" + path, { headers: { apikey: SVC, Authorization: "Bearer " + SVC } });
  if (!r.ok) throw new Error("sb get " + r.status); return r.json();
}
async function sbInsert(table, rows) {
  const r = await fetch(SB + "/rest/v1/" + table, {
    method: "POST",
    headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows)
  });
  if (!r.ok) throw new Error("sb insert " + r.status + " " + (await r.text()));
}


// ---- confirmation email: owner (account email) + office manager + clinician, copy to Kevin ----
const fmtWhen = (ms, dur) => {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(ms));
  const t = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return `${d}, ${t.format(new Date(ms))} – ${t.format(new Date(ms + dur * 60000))} ET`;
};
const esc = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function buildIcs(created, address) {
  const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const fold = (t) => String(t).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Meridian Implant Advisory//Booking//EN", "METHOD:PUBLISH"];
  for (const c of created) {
    const where = VIDEO.has(c.n) ? (c.meet || "Video call — link to follow") : (address || "");
    lines.push("BEGIN:VEVENT", `UID:${c.eventId}@meridianimplantadvisory.com`, `DTSTAMP:${z(Date.now())}`,
      `DTSTART:${z(c.s)}`, `DTEND:${z(c.s + c.dur * 60000)}`, `SUMMARY:${fold(c.title)}`,
      `LOCATION:${fold(where)}`, `DESCRIPTION:${fold(VIDEO.has(c.n) && c.meet ? "Join: " + c.meet : "")}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
async function sendConfirmation(user, created, address) {
  if (!process.env.BREVO_API_KEY) return;
  const ob = (await sbGet(`onboarding_responses?user_id=eq.${user.id}&select=office_manager_name,office_manager_email,clinician_name,clinician_email,practice_name`))[0] || {};
  const to = [];
  const add = (email, name) => { if (email && /@/.test(email) && !to.some((x) => x.email.toLowerCase() === email.toLowerCase())) to.push(name ? { email, name } : { email }); };
  add(user.email); add(ob.clinician_email, ob.clinician_name); add(ob.office_manager_email, ob.office_manager_name);
  const bcc = process.env.MERIDIAN_NOTIFY_EMAIL ? [{ email: process.env.MERIDIAN_NOTIFY_EMAIL }] : undefined;
  const rows = created.map((c) => {
    const where = VIDEO.has(c.n)
      ? (c.meet ? `Video call — <a href="${esc(c.meet)}">join Google Meet</a>` : "Video call — link to follow")
      : esc(address || "At your practice");
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #E5E0D6;vertical-align:top;"><strong>${esc(c.n === 0 ? "Onboarding Call" : "Session " + c.n)}</strong><br>${esc(c.n === 0 ? ONBOARD.title : STEPS[c.i].title)}</td>
      <td style="padding:10px 0 10px 16px;border-bottom:1px solid #E5E0D6;vertical-align:top;">${esc(fmtWhen(c.s, c.dur))}<br><span style="color:#6B7280;">${where}</span></td></tr>`;
  }).join("");
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;color:#151B23;">
    <div style="background:#0F1E2E;padding:24px 32px;text-align:center;"><div style="font-family:Georgia,serif;color:#fff;font-size:20px;letter-spacing:.5px;">MERIDIAN <span style="color:#D9BD90;">IMPLANT ADVISORY</span></div></div>
    <div style="padding:28px 32px;">
      <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;color:#0F1E2E;margin:0 0 10px;">Your implementation schedule is booked.</h1>
      <p style="font-size:15px;line-height:1.6;color:#4A5568;">${esc(ob.practice_name || "Your practice")} — here are your onboarding call and all nine sessions. The attached calendar file adds every one to your calendar in one step. The onboarding call is for the practice owner <strong>and</strong> the office manager.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">${rows}</table>
      <p style="font-size:13px;line-height:1.6;color:#8A94A3;margin-top:20px;">Sessions 2–9 open with a 30-minute implementation check-in, so bring your questions. Need to move something? Reply to this email.</p>
    </div></div>`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": (process.env.BREVO_API_KEY || "").trim(), "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: process.env.REMINDER_FROM_EMAIL || "welcome@meridianimplantadvisory.com", name: process.env.REMINDER_FROM_NAME || "Meridian Implant Advisory" },
      to, ...(bcc ? { bcc } : {}),
      subject: "Your Meridian onboarding call and sessions are booked",
      htmlContent: html,
      attachment: [{ name: "meridian-sessions.ics", content: Buffer.from(buildIcs(created, address)).toString("base64") }]
    })
  });
  if (!r.ok) throw new Error("Brevo " + r.status + " " + (await r.text()));
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in." }, 401);
    const user = await sbUser(token);
    if (!user || !user.id) return json({ error: "Invalid session." }, 401);

    const prof = (await sbGet(`profiles?id=eq.${user.id}&select=membership_tier,role`))[0];
    if (!prof) return json({ error: "No profile found." }, 403);
    if (prof.membership_tier !== "gold") return json({ error: "Scheduling is for Gold clients." }, 403);

    const existing = await sbGet(`client_sessions?user_id=eq.${user.id}&select=session_number`);
    if (existing.length) return json({ error: "Your sessions are already booked." }, 409);

    const body = await req.json();
    const picks = (body && body.sessions) || [];
    if (picks.length !== STEPS.length) return json({ error: "The onboarding call and all nine sessions are required." }, 400);

    const now = Date.now();
    const starts = [];
    const nameOf = (n) => (n === 0 ? "The onboarding call" : "Session " + n);
    for (let i = 0; i < STEPS.length; i++) {
      const p = picks.find((x) => +x.n === STEPS[i].n);
      if (!p) return json({ error: "Missing " + nameOf(STEPS[i].n).toLowerCase() + "." }, 400);
      const s = Date.parse(p.startISO);
      if (isNaN(s)) return json({ error: "Bad time for " + nameOf(STEPS[i].n).toLowerCase() + "." }, 400);
      const et = etParts(s);
      const startMin = et.hh * 60 + et.mm, endMin = startMin + STEPS[i].dur;
      if (et.weekday < 1 || et.weekday > 5) return json({ error: `${nameOf(STEPS[i].n)} must be on a weekday.` }, 400);
      if (isUsHoliday(et.y, et.mo, et.d)) return json({ error: `${nameOf(STEPS[i].n)} falls on a holiday.` }, 400);
      if (startMin < WORKSTART * 60 || endMin > WORKEND * 60) return json({ error: `${nameOf(STEPS[i].n)} must sit within 9–5 ET.` }, 400);
      starts.push({ n: STEPS[i].n, i, s, dur: STEPS[i].dur, et });
    }
    const dayIdx = (et) => Date.UTC(et.y, et.mo - 1, et.d) / 864e5;
    if (starts[0].s < now + OB_LEAD * 864e5) return json({ error: `The onboarding call must be at least ${OB_LEAD} days out.` }, 400);
    if (starts[1].s < now + LEAD * 864e5) return json({ error: `Session 1 must be at least ${LEAD} days out.` }, 400);
    const obGap = dayIdx(starts[1].et) - dayIdx(starts[0].et);
    if (obGap < OB_MIN_BEFORE_S1 || obGap > OB_MAX_BEFORE_S1) return json({ error: `Session 1 must be ${OB_MIN_BEFORE_S1}–${OB_MAX_BEFORE_S1} days after the onboarding call.` }, 400);
    for (let i = 2; i < starts.length; i++) {
      const gap = dayIdx(starts[i].et) - dayIdx(starts[i - 1].et);
      if (gap < GAP_MIN || gap > GAP_MAX) return json({ error: `Session ${starts[i].n} must be ${GAP_MIN}–${GAP_MAX} days after session ${starts[i - 1].n}.` }, 400);
    }

    // live conflict re-check
    const gToken = await googleToken(JSON.parse(process.env.GOOGLE_SA_KEY));
    const calId = process.env.GCAL_ID;
    const fromMs = now, toMs = starts[starts.length - 1].s + 864e5;
    let busy = await googleBusyRange(gToken, calId, fromMs, toMs);
    const feeds = (process.env.M365_ICS_FEEDS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const fetched = await Promise.allSettled(feeds.map((u) => fetch(u).then((r) => r.text())));
    for (const f of fetched) if (f.status === "fulfilled") { try { busy = busy.concat(parseICSBusy(f.value, fromMs, toMs)); } catch (_) {} }
    for (const st of starts) {
      const a = st.s - BUFFER * 60000, b = st.s + st.dur * 60000 + BUFFER * 60000;
      for (const iv of busy) if (a < iv[1] && b > iv[0]) return json({ error: `Session ${st.n} just conflicted with another commitment — please pick a different time.` }, 409);
    }

    // create events
    const practiceLabel = (body.practiceLabel || "").trim();
    const address = (body.address || "").trim();
    const created = [];
    try {
      for (const st of starts) {
        const isOB = st.n === 0;
        const title = (practiceLabel ? practiceLabel + " — " : "") + (isOB ? "Meridian Onboarding Call (video): " : `Meridian Session ${st.n}: `) + STEPS[st.i].title;
        const ev = {
          summary: title,
          description: isOB
            ? "Video call with the practice owner and office manager, before Session 1.\nAgenda: how implementation will run; the office manager's role and data entry; walkthrough of the client portal and resources.\nAdd the video link to this event and send it to the practice."
            : `Session ${st.n} of 9 — Meridian implementation.\n${st.n > 1 ? "Opens with a 30-minute Implementation check-in on previous sessions.\n" : ""}Review the previous session's Next Steps and bring the Session ${st.n} worksheets.`,
          start: { dateTime: new Date(st.s).toISOString(), timeZone: "America/New_York" },
          end: { dateTime: new Date(st.s + st.dur * 60000).toISOString(), timeZone: "America/New_York" }
        };
        if (address && !VIDEO.has(st.n)) ev.location = address;   // video steps get the Meet link instead
        const g = await insertEvent(gToken, calId, ev, VIDEO.has(st.n));
        created.push({ ...st, title, eventId: g.id, meet: g._meet || null });
      }
    } catch (e) {
      for (const c of created) { try { await deleteEvent(gToken, calId, c.eventId); } catch (_) {} }
      return json({ error: "Could not create the calendar events: " + String((e && e.message) || e) }, 502);
    }

    // store
    try {
      await sbInsert("client_sessions", created.map((c) => ({
        user_id: user.id, session_number: c.n, title: c.title,
        starts_at: new Date(c.s).toISOString(), ends_at: new Date(c.s + c.dur * 60000).toISOString(),
        duration_min: c.dur, gcal_event_id: c.eventId, status: "booked"
      })));
    } catch (e) {
      for (const c of created) { try { await deleteEvent(gToken, calId, c.eventId); } catch (_) {} }
      return json({ error: "Saved to calendar but the record failed — rolled back so you can retry. " + String((e && e.message) || e) }, 500);
    }

    // confirmation email (best-effort: the booking is already saved)
    try { await sendConfirmation(user, created, address); }
    catch (e) { console.error("book-sessions confirmation email:", String((e && e.message) || e)); }

    return json({ ok: true, sessions: created.map((c) => ({ n: c.n, title: c.title, startISO: new Date(c.s).toISOString(), dur: c.dur, meet: c.meet })) });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};
