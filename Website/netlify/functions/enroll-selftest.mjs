// TEMPORARY diagnostic — GET /.netlify/functions/enroll-selftest?token=mia-diag-7742
// Add &sendtest=1 to actually send a test email via Brevo and report the result.
// Reveals no secret values. Delete once enrollment is verified.

const TOKEN = "mia-diag-7742";
function j(o) { return new Response(JSON.stringify(o, null, 2), { status: 200, headers: { "Content-Type": "application/json" } }); }

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== TOKEN) return new Response("not found", { status: 404 });
  const doSend = url.searchParams.get("sendtest") === "1";

  const out = { env: {}, checks: {} };
  const sk = process.env.STRIPE_SECRET_KEY || "";
  out.env.STRIPE_SECRET_KEY = sk ? (sk.startsWith("sk_test_") ? "present · TEST" : sk.startsWith("sk_live_") ? "present · LIVE" : "present · ?") : "MISSING";
  out.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ? "present" : "MISSING";
  out.env.SUPABASE_URL = process.env.SUPABASE_URL ? "present" : "MISSING";
  out.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ? "present" : "MISSING";
  out.env.BREVO_API_KEY = process.env.BREVO_API_KEY ? "present" : "MISSING";
  out.env.REMINDER_FROM_EMAIL = process.env.REMINDER_FROM_EMAIL || "(default) welcome@meridianimplantadvisory.com";

  // Brevo — raw domains so we see the real structure + which domain is authenticated
  try {
    const r = await fetch("https://api.brevo.com/v3/senders/domains", { headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" } });
    out.checks.brevo_domains = r.ok ? (await r.json()).domains : ("FAIL " + r.status);
  } catch (e) { out.checks.brevo_domains = "ERROR " + (e.message || e); }

  // Supabase — did a new user get created? (count + recent timestamps)
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/admin/users?per_page=10", { headers: { apikey: key, Authorization: "Bearer " + key } });
    if (!r.ok) out.checks.supabase = "FAIL " + r.status + " — " + (await r.text()).slice(0, 160);
    else {
      const d = await r.json(); const users = d.users || (Array.isArray(d) ? d : []);
      out.checks.supabase_user_count = users.length;
      out.checks.supabase_recent = users.map((u) => ({ created_at: u.created_at, email_local_len: (u.email || "").split("@")[0].length, domain: (u.email || "").split("@")[1] || "?" })).slice(0, 6);
    }
  } catch (e) { out.checks.supabase = "ERROR " + (e.message || e); }

  // Optional: actually try sending an email from the same "from" the webhook uses.
  if (doSend) {
    const from = process.env.REMINDER_FROM_EMAIL || "welcome@meridianimplantadvisory.com";
    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender: { email: from, name: "Meridian Implant Advisory" }, to: [{ email: "kcoop007@gmail.com" }], subject: "Meridian enrollment — test email", htmlContent: "<p>This is a Meridian self-test email. If you received it, Brevo sending works from <b>" + from + "</b>.</p>" })
      });
      out.checks.test_email = r.ok ? ("SENT OK from " + from) : ("FAIL " + r.status + " — " + (await r.text()).slice(0, 220));
    } catch (e) { out.checks.test_email = "ERROR " + (e.message || e); }
  } else {
    out.checks.test_email = "(add &sendtest=1 to the URL to actually send a test email)";
  }

  return j(out);
};
