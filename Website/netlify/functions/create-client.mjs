// POST /.netlify/functions/create-client
// Body: { session_id, password, full_name, practice_name, onboarding:{...} }
//
// Runs only after a real Stripe payment: it re-verifies the session with
// Stripe, derives the tier from the actual amount paid, then creates (or
// updates) the client's Supabase account, stamps the tier, and stores their
// onboarding answers + waiver acceptance. Nothing here trusts the browser
// for the tier or the fact of payment.
//
// Required Netlify env vars:
//   STRIPE_SECRET_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (secret — bypasses RLS)

const TIER_BY_ONBOARD_CENTS = { 49500: "bronze", 295000: "silver", 950000: "gold" };
const WAIVER_VERSION = "v1-2026-07";

function json(o, code = 200) {
  return new Response(JSON.stringify(o), { status: code, headers: { "Content-Type": "application/json" } });
}

async function stripeGet(path) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY }
  });
  if (!r.ok) throw new Error("Stripe " + path + ": " + r.status + " " + (await r.text()));
  return r.json();
}
function tierFromSession(session) {
  const items = (session.line_items && session.line_items.data) || [];
  for (const it of items) { const p = it.price || {}; if (p.type === "one_time" && TIER_BY_ONBOARD_CENTS[p.unit_amount]) return TIER_BY_ONBOARD_CENTS[p.unit_amount]; }
  for (const it of items) { const p = it.price || {}; if (TIER_BY_ONBOARD_CENTS[p.unit_amount]) return TIER_BY_ONBOARD_CENTS[p.unit_amount]; }
  return null;
}

// Supabase REST (service role — bypasses RLS)
async function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/" + path, {
    ...opts,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  if (!r.ok) throw new Error("Supabase " + path + ": " + r.status + " " + (await r.text()));
  return r.status === 204 ? null : r.json();
}
// Supabase Auth admin (create / update users)
async function gotrue(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/" + path, {
    ...opts,
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let d;
  try { d = await req.json(); } catch { return json({ error: "bad JSON" }, 400); }
  const { session_id, password } = d || {};
  if (!session_id) return json({ error: "missing session_id" }, 400);
  if (!password || String(password).length < 8) return json({ error: "password must be at least 8 characters" }, 400);

  try {
    // 1) Verify the payment with Stripe and derive tier + email from it.
    const s = await stripeGet("checkout/sessions/" + encodeURIComponent(session_id) + "?expand[]=line_items.data.price");
    const paid = s.payment_status === "paid" || s.status === "complete";
    if (!paid) return json({ error: "This checkout is not paid." }, 402);
    const tier = tierFromSession(s);
    const email = (s.customer_details && s.customer_details.email) || s.customer_email;
    if (!email) return json({ error: "No email on the payment." }, 400);
    if (!tier) return json({ error: "Could not determine tier from payment." }, 400);

    // 2) Create the auth user (or set the password if they already exist).
    let userId;
    const created = await gotrue("admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
    if (created.ok) {
      userId = created.body.id;
    } else {
      // Already registered — find their id (profile is auto-created by trigger) and set the password.
      const rows = await sb("profiles?select=id&email=eq." + encodeURIComponent(email));
      if (!rows || !rows.length) throw new Error("User exists but profile not found for " + email);
      userId = rows[0].id;
      const upd = await gotrue("admin/users/" + userId, { method: "PUT", body: JSON.stringify({ password, email_confirm: true }) });
      if (!upd.ok) throw new Error("Could not set password: " + JSON.stringify(upd.body));
    }

    // 3) Stamp the profile with the tier + practice details.
    await sb("profiles?id=eq." + userId, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        membership_tier: tier,
        is_active: true,
        full_name: d.full_name || null,
        practice_name: d.practice_name || null
      })
    });

    // 4) Save onboarding answers (upsert) + waiver acceptance + membership record.
    const ob = d.onboarding || {};
    await sb("onboarding_responses?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        user_id: userId,
        goals: ob.goals || null,
        bottlenecks: ob.bottlenecks || null,
        num_doctors: ob.num_doctors ? parseInt(ob.num_doctors, 10) : null,
        has_treatment_coordinator: ob.treatment_coordinator === "yes" ? true : ob.treatment_coordinator === "no" ? false : null,
        staff_structure: ob.staff_summary ? { summary: ob.staff_summary } : null,
        prior_systems: ob.prior_systems || null,
        raw: ob,
        updated_at: new Date().toISOString()
      }])
    });
    await sb("waiver_acceptances", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ user_id: userId, waiver_version: WAIVER_VERSION, user_agent: d.user_agent || null }])
    });
    await sb("memberships?on_conflict=stripe_session_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        user_id: userId, tier: tier, stripe_session_id: session_id,
        stripe_customer: s.customer || null, amount_total: s.amount_total || null
      }])
    });

    return json({ ok: true, email: email, tier: tier });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};
