// GET /.netlify/functions/availability?from=ISO&to=ISO
// Returns Kevin's merged BUSY intervals over the window, so the scheduling
// wizard can render open slots. Busy = his Google "Meridian Sessions" calendar
// (other clients' bookings) + the published M365 availability feeds.
//
// Env: GOOGLE_SA_KEY (JSON), GCAL_ID, M365_ICS_FEEDS (comma-separated)
import crypto from "node:crypto";

const b64url = (b) =>
  Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const clm = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  }));
  const input = hdr + "." + clm;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(input); signer.end();
  const sig = b64url(signer.sign(sa.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: input + "." + sig
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error("google token: " + JSON.stringify(j));
  return j.access_token;
}

// Offset (minutes) such that ET wall-clock = UTC + offset, at instant ms.
function etOffset(ms) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const p = {}; f.formatToParts(new Date(ms)).forEach((x) => (p[x.type] = x.value));
  const h = p.hour === "24" ? 0 : +p.hour;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
  return Math.round((asUTC - ms) / 60000);
}
// UTC ms for a given ET wall-clock time.
function etToUtcMs(y, mo, d, hh, mm) {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  let off = etOffset(guess);
  let ms = guess - off * 60000;
  const off2 = etOffset(ms);
  if (off2 !== off) ms = guess - off2 * 60000;
  return ms;
}

function icsToMs(val) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/.exec(val);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const hh = m[4] ? +m[4] : 0, mm = m[5] ? +m[5] : 0, ss = m[6] ? +m[6] : 0;
  if (m[7] === "Z") return Date.UTC(y, mo - 1, d, hh, mm, ss);
  if (!m[4]) return etToUtcMs(y, mo, d, 0, 0); // all-day -> ET midnight
  return etToUtcMs(y, mo, d, hh, mm);          // TZID/floating -> treat as ET
}

function parseICSBusy(text, fromMs, toMs) {
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const out = [];
  const parts = unfolded.split("BEGIN:VEVENT").slice(1);
  for (const ev of parts) {
    const body = ev.split("END:VEVENT")[0];
    const ds = /DTSTART[^:\n]*:([0-9TZ]+)/.exec(body);
    const de = /DTEND[^:\n]*:([0-9TZ]+)/.exec(body);
    if (!ds) continue;
    const s = icsToMs(ds[1]);
    if (s == null) continue;
    const e = de ? icsToMs(de[1]) : s + 3600000;
    if (e > fromMs && s < toMs) out.push([s, e]);
  }
  return out;
}

async function googleBusy(token, calId, fromISO, toISO) {
  const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: fromISO, timeMax: toISO, items: [{ id: calId }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error("freebusy: " + JSON.stringify(j));
  const cal = j.calendars && j.calendars[calId];
  return ((cal && cal.busy) || []).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
}
// freeBusy rejects long ranges ("timeRangeTooLong"), so query in ~30-day chunks.
async function googleBusyRange(token, calId, fromMs, toMs) {
  const CHUNK = 30 * 864e5;
  let out = [];
  for (let s = fromMs; s < toMs; s += CHUNK) {
    const e = Math.min(s + CHUNK, toMs);
    out = out.concat(await googleBusy(token, calId, new Date(s).toISOString(), new Date(e).toISOString()));
  }
  return out;
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const fromMs = Date.parse(url.searchParams.get("from") || new Date().toISOString());
    const toMs = Date.parse(url.searchParams.get("to") || new Date(Date.now() + 165 * 864e5).toISOString());

    const sa = JSON.parse(process.env.GOOGLE_SA_KEY);
    const calId = process.env.GCAL_ID;
    const feeds = (process.env.M365_ICS_FEEDS || "").split(",").map((s) => s.trim()).filter(Boolean);

    const token = await googleToken(sa);
    let busy = await googleBusyRange(token, calId, fromMs, toMs);

    const fetched = await Promise.allSettled(feeds.map((u) => fetch(u).then((r) => r.text())));
    for (const f of fetched) {
      if (f.status === "fulfilled") {
        try { busy = busy.concat(parseICSBusy(f.value, fromMs, toMs)); } catch (_) {}
      }
    }

    busy.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of busy) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }

    return new Response(JSON.stringify({
      busy: merged.map((x) => [new Date(x[0]).toISOString(), new Date(x[1]).toISOString()]),
      now: new Date().toISOString()
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};
