// Netlify Scheduled Function — runs hourly, sends any reminders that are due
// this hour (Eastern) via Brevo, optionally with a calendar (.ics) invite.
//
// Required Netlify environment variables:
//   SUPABASE_URL                 e.g. https://zesnsbxkiteqzggkckyz.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    (secret — server-only; bypasses RLS)
//   BREVO_API_KEY                (secret — xkeysib-…)
// Optional:
//   REMINDER_FROM_EMAIL          default clientdevelopment@meridianimplantadvisory.com
//   REMINDER_FROM_NAME           default "Meridian Implant Advisory"
//
// The isDue logic below mirrors js/reminder-schedule.js (which is unit-tested).

// DISABLED (off until further notice) to save Netlify credits.
// To re-enable the hourly run, restore: export const config = { schedule: "@hourly" };
export const config = {};

function partsInTZ(date, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", year: "numeric",
    month: "numeric", day: "numeric", hour: "numeric", hour12: false
  });
  const o = {};
  f.formatToParts(date).forEach((p) => { o[p.type] = p.value; });
  const w = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: +o.year, month: +o.month, day: +o.day, weekday: w[o.weekday], hour: (+o.hour) % 24 };
}

function isDue(r, date) {
  if (!r || r.active === false) return false;
  const p = partsInTZ(date, r.timezone || "America/New_York");
  const hour = parseInt((r.time_local || "07:00").split(":")[0], 10);
  if (p.hour !== hour) return false;
  const dom = r.day_of_month || 1;
  const wds = r.byweekday && r.byweekday.length ? r.byweekday : null;
  switch (r.frequency) {
    case "daily":     return wds ? wds.includes(p.weekday) : true;
    case "weekly":    return (wds ? wds[0] : 1) === p.weekday;
    case "monthly":   return p.day === dom;
    case "quarterly": return [1, 4, 7, 10].includes(p.month) && p.day === dom;
    case "biannual":  return (p.month === 1 || p.month === 7) && p.day === dom;
    case "custom":    return wds ? wds.includes(p.weekday) : true;
    default:          return false;
  }
}

async function sb(path, opts = {}) {
  const url = process.env.SUPABASE_URL + "/rest/v1/" + path;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(url, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error("Supabase " + path + ": " + res.status + " " + (await res.text()));
  return res.status === 204 ? null : res.json();
}

function icsFor(reminder, whenET) {
  // A single-occurrence event for today at the reminder time (floating ET time).
  const y = whenET.year, m = String(whenET.month).padStart(2, "0"), d = String(whenET.day).padStart(2, "0");
  const hh = String(whenET.hour).padStart(2, "0");
  const dt = `${y}${m}${d}T${hh}0000`;
  const uid = "meridian-" + reminder.id + "-" + dt + "@meridianimplantadvisory.com";
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Meridian Implant Advisory//Reminders//EN",
    "BEGIN:VEVENT", "UID:" + uid, "DTSTART;TZID=America/New_York:" + dt,
    "DURATION:PT30M", "SUMMARY:" + reminder.title,
    "DESCRIPTION:" + (reminder.notes || "Meridian Implant Advisory reminder"),
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
}

function safeJson(v) { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }

async function sendEmail(to, reminder, whenET) {
  const from = process.env.REMINDER_FROM_EMAIL || "clientdevelopment@meridianimplantadvisory.com";
  const name = process.env.REMINDER_FROM_NAME || "Meridian Implant Advisory";
  const wantsCal = reminder.channel === "calendar" || reminder.channel === "both";
  // A reminder that only says "Daily huddle" makes the reader go and find out
  // what a daily huddle is for. These carry the goal, the agenda and links to the
  // exact documents needed, so the email IS the meeting prep.
  const SITE = process.env.SITE_URL || "https://meridianimplantadvisory.com";
  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const asArray = (v) => Array.isArray(v) ? v : (typeof v === "string" ? safeJson(v) : []);

  const agenda = asArray(reminder.agenda);
  const docs = asArray(reminder.docs);

  const goalHtml = reminder.goal
    ? `<p style="margin:0 0 6px;color:#5A6472;font-size:13px;text-transform:uppercase;letter-spacing:.06em;">The goal</p>
       <p style="margin:0 0 20px;font-size:15px;">${esc(reminder.goal)}</p>` : "";

  const agendaHtml = agenda.length
    ? `<p style="margin:0 0 6px;color:#5A6472;font-size:13px;text-transform:uppercase;letter-spacing:.06em;">What to cover</p>
       <ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.6;">
         ${agenda.map((a) => `<li style="margin-bottom:6px;">${esc(a)}</li>`).join("")}
       </ul>` : "";

  const docsHtml = docs.length
    ? `<p style="margin:0 0 6px;color:#5A6472;font-size:13px;text-transform:uppercase;letter-spacing:.06em;">Documents you'll need</p>
       <p style="margin:0 0 20px;font-size:15px;line-height:1.9;">
         ${docs.map((d) => `<a href="${SITE}${esc(d.href)}" style="color:#B8863B;font-weight:600;">${esc(d.label)}</a>`).join("<br>")}
       </p>` : "";

  const body = {
    sender: { email: from, name },
    to: [{ email: to }],
    subject: reminder.title,
    htmlContent:
      `<div style="font-family:Arial,Helvetica,sans-serif;color:#151B23;max-width:560px;">
        <p style="font-size:18px;font-weight:600;margin:0 0 18px;">${esc(reminder.title)}</p>
        ${goalHtml}${agendaHtml}${docsHtml}
        ${reminder.notes ? `<p style="font-size:15px;">${esc(reminder.notes)}</p>` : ""}
        <p style="border-top:1px solid #E3DED5;padding-top:14px;color:#8A94A3;font-size:12px;line-height:1.6;">
          Sent by Meridian Implant Advisory.
          <a href="${SITE}/reminders.html" style="color:#8A94A3;">Change the day, time or recipient</a>.
        </p>
      </div>`
  };
  if (wantsCal) {
    const ics = icsFor(reminder, whenET);
    body.attachment = [{ content: Buffer.from(ics).toString("base64"), name: "reminder.ics" }];
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("Brevo: " + res.status + " " + (await res.text()));
}

export default async () => {
  const now = new Date();
  try {
    const reminders = await sb("reminders?active=eq.true&select=*");
    if (!reminders.length) return new Response("no active reminders");

    const profiles = await sb("profiles?select=id,email");
    const emailById = {};
    profiles.forEach((p) => { emailById[p.id] = p.email; });

    let sent = 0;
    for (const r of reminders) {
      if (!isDue(r, now)) continue;
      const to = r.target_email || emailById[r.user_id];
      const whenET = partsInTZ(now, r.timezone || "America/New_York");
      let status = "sent", detail = null;
      try {
        if (!to) throw new Error("no recipient email");
        await sendEmail(to, r, whenET);
        sent++;
      } catch (e) {
        status = "error"; detail = String(e.message || e);
      }
      await sb("reminder_log", {
        method: "POST",
        body: JSON.stringify({ reminder_id: r.id, status, detail })
      });
    }
    return new Response("dispatched " + sent + " reminder(s)");
  } catch (e) {
    return new Response("error: " + (e.message || e), { status: 500 });
  }
};
