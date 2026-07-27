// TEMPORARY diagnostic — GET /.netlify/functions/enroll-selftest?token=mia-diag-7742
// Reports whether the enrollment env vars + services are wired correctly, WITHOUT
// exposing any secret values. Safe to delete once enrollment is verified.

const TOKEN = "mia-diag-7742";

function j(o) { return new Response(JSON.stringify(o, null, 2), { status: 200, headers: { "Content-Type": "application/json" } }); }

export default async (req) => {
  if (new URL(req.url).searchParams.get("token") !== TOKEN) return new Response("not found", { status: 404 });

  const out = { env: {}, checks: {} };
  const sk = process.env.STRIPE_SECRET_KEY || "";
  out.env.STRIPE_SECRET_KEY = sk ? (sk.startsWith("sk_test_") ? "present · TEST mode" : sk.startsWith("sk_live_") ? "present · LIVE mode" : "present · unknown prefix") : "MISSING";
  out.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ? "present" : "MISSING";
  out.env.SUPABASE_URL = process.env.SUPABASE_URL ? "present" : "MISSING";
  out.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ? "present" : "MISSING";
  out.env.BREVO_API_KEY = process.env.BREVO_API_KEY ? "present" : "MISSING";

  // Stripe: is the key valid, and what mode?
  try {
    const r = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: "Bearer " + sk } });
    out.checks.stripe = r.ok ? ("OK — key valid (" + (sk.startsWith("sk_test_") ? "test" : "live") + " mode)") : ("FAIL " + r.status + " — " + (await r.text()).slice(0, 140));
  } catch (e) { out.checks.stripe = "ERROR " + (e.message || e); }

  // Brevo: key valid? which senders / domains are verified? (this is what the welcome email needs)
  try {
    const r = await fetch("https://api.brevo.com/v3/senders", { headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" } });
    if (!r.ok) out.checks.brevo = "FAIL " + r.status + " — " + (await r.text()).slice(0, 160);
    else { const d = await r.json(); out.checks.brevo_senders = (d.senders || []).map((s) => ({ email: s.email, active: s.active })); }
  } catch (e) { out.checks.brevo = "ERROR " + (e.message || e); }
  try {
    const r = await fetch("https://api.brevo.com/v3/senders/domains", { headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" } });
    if (r.ok) { const d = await r.json(); out.checks.brevo_domains = (d.domains || []).map((x) => ({ domain: x.domain, authenticated: x.authenticated })); }
  } catch (e) { /* domains list is optional */ }

  // Supabase: does the service role work, and were any users created recently?
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/admin/users?per_page=3", { headers: { apikey: key, Authorization: "Bearer " + key } });
    if (!r.ok) out.checks.supabase = "FAIL " + r.status + " — " + (await r.text()).slice(0, 160);
    else {
      const d = await r.json(); const users = d.users || (Array.isArray(d) ? d : []);
      out.checks.supabase_total_seen = users.length;
      out.checks.supabase_recent_users = users.slice(0, 3).map((u) => ({ created_at: u.created_at, email_domain: (u.email || "").split("@")[1] || "?" }));
    }
  } catch (e) { out.checks.supabase = "ERROR " + (e.message || e); }

  return j(out);
};
