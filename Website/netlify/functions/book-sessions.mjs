// POST /.netlify/functions/book-sessions
// Body: { sessions:[{n, startISO}], practiceLabel, address }
// Header: Authorization: Bearer <supabase user access token>
//
// Server-authoritative: re-validates durations, 9–5 ET weekday window, the
// 2–3 week gaps, the lead time, and live conflicts before creating the six
// Google Calendar events and storing them. Rolls back events if the DB write
// fails. Env: GOOGLE_SA_KEY, GCAL_ID, M365_ICS_FEEDS, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
import crypto from "node:crypto";

// ---- config (must mirror js/scheduling-config.js) ----
const SESSIONS = [
  { n: 1, title: "Purpose & Offer", dur: 90 },
  { n: 2, title: "Biology & Language", dur: 90 },
  { n: 3, title: "Finding Patients", dur: 90 },
  { n: 4, title: "Knowing the Patient & Presenting", dur: 120 },
  { n: 5, title: "Money & Paperwork", dur: 120 },
  { n: 6, title: "Clinical Track — Surgery Day & Maintenance", dur: 90 }
];
const GAP_MIN = 14, GAP_MAX = 21, LEAD = 10, WORKSTART = 9, WORKEND = 17, BUFFER = 0;

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
async function insertEvent(token, calId, ev) {
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(ev)
  });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j;
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
    if (picks.length !== SESSIONS.length) return json({ error: "All six sessions are required." }, 400);

    const now = Date.now();
    const starts = [];
    for (let i = 0; i < SESSIONS.length; i++) {
      const p = picks.find((x) => +x.n === SESSIONS[i].n);
      if (!p) return json({ error: "Missing session " + SESSIONS[i].n + "." }, 400);
      const s = Date.parse(p.startISO);
      if (isNaN(s)) return json({ error: "Bad time for session " + SESSIONS[i].n + "." }, 400);
      const et = etParts(s);
      const startMin = et.hh * 60 + et.mm, endMin = startMin + SESSIONS[i].dur;
      if (et.weekday < 1 || et.weekday > 5) return json({ error: `Session ${SESSIONS[i].n} must be a weekday.` }, 400);
      if (startMin < WORKSTART * 60 || endMin > WORKEND * 60) return json({ error: `Session ${SESSIONS[i].n} must sit within 9–5 ET.` }, 400);
      starts.push({ n: SESSIONS[i].n, i, s, dur: SESSIONS[i].dur, et });
    }
    if (starts[0].s < now + LEAD * 864e5) return json({ error: `Session 1 must be at least ${LEAD} days out.` }, 400);
    const dayIdx = (et) => Date.UTC(et.y, et.mo - 1, et.d) / 864e5;
    for (let i = 1; i < starts.length; i++) {
      const gap = dayIdx(starts[i].et) - dayIdx(starts[i - 1].et);
      if (gap < GAP_MIN || gap > GAP_MAX) return json({ error: `Session ${starts[i].n} must be ${GAP_MIN}–${GAP_MAX} days after session ${starts[i - 1].n}.` }, 400);
    }

    // live conflict re-check
    const gToken = await googleToken(JSON.parse(process.env.GOOGLE_SA_KEY));
    const calId = process.env.GCAL_ID;
    const fromMs = now, toMs = starts[starts.length - 1].s + 864e5;
    let busy = await googleBusy(gToken, calId, new Date(fromMs).toISOString(), new Date(toMs).toISOString());
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
        const title = (practiceLabel ? practiceLabel + " — " : "") + `Meridian Session ${st.n}: ` + SESSIONS[st.i].title;
        const ev = {
          summary: title,
          description: `Session ${st.n} of 6 — Meridian implementation.\nReview the previous session's Next Steps and bring the Session ${st.n} worksheets.`,
          start: { dateTime: new Date(st.s).toISOString(), timeZone: "America/New_York" },
          end: { dateTime: new Date(st.s + st.dur * 60000).toISOString(), timeZone: "America/New_York" }
        };
        if (address) ev.location = address;
        const g = await insertEvent(gToken, calId, ev);
        created.push({ ...st, title, eventId: g.id });
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

    return json({ ok: true, sessions: created.map((c) => ({ n: c.n, title: c.title, startISO: new Date(c.s).toISOString(), dur: c.dur })) });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};
