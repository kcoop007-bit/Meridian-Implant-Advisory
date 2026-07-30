// TEMPORARY diagnostic — DELETE after we've fixed the welcome-email send.
// Token-gated. Reports env presence (never the secret values), the Brevo
// verified senders/domains, whether a given user exists, and — with &send=1 —
// fires a real welcome-style email so we can read Brevo's actual response.
//
//   /.netlify/functions/enroll-selftest?t=mia-diag-8815&to=you@example.com&send=1
const TOKEN = "mia-diag-8815";

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("t") !== TOKEN) return new Response("nope", { status: 403 });
  const to = url.searchParams.get("to") || "";
  const doSend = url.searchParams.get("send") === "1";

  const sk = process.env.STRIPE_SECRET_KEY || "";
  const out = {
    env: {
      stripe_key_mode: sk.startsWith("sk_live") ? "LIVE" : sk.startsWith("sk_test") ? "TEST" : (sk ? "unknown" : "MISSING"),
      stripe_webhook_secret: process.env.STRIPE_WEBHOOK_SECRET ? "set" : "MISSING",
      brevo_key: process.env.BREVO_API_KEY ? "set" : "MISSING",
      from_email: process.env.REMINDER_FROM_EMAIL || "(default) welcome@meridianimplantadvisory.com",
      from_name: process.env.REMINDER_FROM_NAME || "(default) Meridian Implant Advisory",
      supabase_url: process.env.SUPABASE_URL ? "set" : "MISSING",
      service_role: process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "MISSING"
    },
    brevo: {}, supabase: {}, send: null
  };

  try {
    const r = await fetch("https://api.brevo.com/v3/senders", { headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" } });
    out.brevo.senders_status = r.status;
    const j = await r.json().catch(() => ({}));
    out.brevo.senders = (j.senders || []).map((s) => ({ email: s.email, active: s.active }));
  } catch (e) { out.brevo.senders_error = String((e && e.message) || e); }

  try {
    const r = await fetch("https://api.brevo.com/v3/senders/domains", { headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    out.brevo.domains = j.domains || j; // raw, so we see the real domain name + auth flags
  } catch (e) { out.brevo.domains_error = String((e && e.message) || e); }

  // Brevo account state — a fresh account under review can accept (201) but not deliver.
  try {
    const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    out.brevo.account = { plan: j.plan, relay: j.relay, email: j.email };
  } catch (e) { out.brevo.account_error = String((e && e.message) || e); }

  if (to) {
    try {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/profiles?select=id,email,membership_tier,is_active&email=eq." + encodeURIComponent(to), { headers: { apikey: key, Authorization: "Bearer " + key } });
      out.supabase.profile = await r.json().catch(() => null);
    } catch (e) { out.supabase.error = String((e && e.message) || e); }
  }

  if (doSend && to) {
    const from = process.env.REMINDER_FROM_EMAIL || "welcome@meridianimplantadvisory.com";
    const name = process.env.REMINDER_FROM_NAME || "Meridian Implant Advisory";
    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender: { email: from, name }, to: [{ email: to }], subject: "Meridian diagnostic — test send", htmlContent: "<p>Diagnostic test from the enrollment pipeline. If you got this, the welcome email will work too.</p>" })
      });
      out.send = { from, status: r.status, body: await r.text() };
    } catch (e) { out.send = { error: String((e && e.message) || e) }; }
  }

  // What actually happened to recent sends — delivered / bounced / blocked / deferred.
  try {
    const q = "https://api.brevo.com/v3/smtp/statistics/events?limit=50&days=2" + (to ? "&email=" + encodeURIComponent(to) : "");
    const r = await fetch(q, { headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" } });
    out.brevo.events_status = r.status;
    const j = await r.json().catch(() => ({}));
    out.brevo.events = (j.events || []).map((e) => ({ email: e.email, event: e.event, subject: e.subject, date: e.date, reason: e.reason }));
  } catch (e) { out.brevo.events_error = String((e && e.message) || e); }

  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
};
