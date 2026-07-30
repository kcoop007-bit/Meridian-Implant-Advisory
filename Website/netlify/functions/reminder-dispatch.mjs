// Netlify Scheduled Function — runs hourly, sends any reminders that are due
// this hour (Eastern) via Brevo, optionally with a calendar (.ics) invite.
//
// Required Netlify environment variables:
//   SUPABASE_URL                 e.g. https://zesnsbxkiteqzggkckyz.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    (secret — server-only; bypasses RLS)
//   BREVO_API_KEY                (secret — xkeysib-…)
// Optional:
//   REMINDER_FROM_EMAIL          default reminders@meridianimplantadvisory.com
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

async function sendEmail(to, reminder, whenET) {
  const from = process.env.REMINDER_FROM_EMAIL || "reminders@meridianimplantadvisory.com";
  const name = process.env.REMINDER_FROM_NAME || "Meridian Implant Advisory";
  const wantsCal = reminder.channel === "calendar" || reminder.channel === "both";
  const body = {
    sender: { email: from, name },
    to: [{ email: to }],
    subject: "Reminder: " + reminder.title,
    htmlContent:
      `<div style="font-family:Arial,sans-serif;color:#151B23;">
        <p style="font-size:16px;"><strong>${reminder.title}</strong></p>
        ${reminder.notes ? `<p>${reminder.notes}</p>` : ""}
        <p style="color:#8A94A3;font-size:13px;">Sent by your Meridian Implant Advisory account. Manage or pause this reminder from your account page.</p>
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
