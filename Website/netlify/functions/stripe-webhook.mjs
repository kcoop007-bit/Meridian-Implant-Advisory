// POST /.netlify/functions/stripe-webhook   (Stripe → this endpoint)
// Fires the instant a Checkout payment succeeds — independent of whether the
// client finished onboarding. It:
//   #1  creates the client's Supabase account, stamped with the tier read from
//       the actual payment amount, and records the purchase;
//   #3  emails them a branded Meridian welcome with a secure link to set their
//       password and get started (sent via Brevo).
// Onboarding itself is captured on their first login (see resources.js).
//
// Required Netlify env vars:
//   STRIPE_WEBHOOK_SECRET      (whsec_… — from the Stripe webhook you create)
//   STRIPE_SECRET_KEY          (sk_live_… — to expand line items for the tier)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   BREVO_API_KEY
// Optional:
//   SITE_URL                   default https://meridianimplantadvisory.com
//   REMINDER_FROM_EMAIL        default welcome@meridianimplantadvisory.com
//   REMINDER_FROM_NAME         default "Meridian Implant Advisory"

import crypto from "node:crypto";

const TIER_BY_ONBOARD_CENTS = { 49500: "bronze", 295000: "silver", 950000: "gold" };
const TIER_LABEL = { bronze: "Bronze — The Playbook", silver: "Silver — Playbook + Platform", gold: "Gold — Premium On-Site Implementation" };

function ok(msg) { return new Response(msg || "ok", { status: 200 }); }
function bad(code, msg) { return new Response(msg || "error", { status: code }); }

function verifyStripeSig(payload, header, secret) {
  if (!header) return false;
  const parts = {};
  header.split(",").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) { const k = kv.slice(0, i); const v = kv.slice(i + 1); (parts[k] = parts[k] || []).push(v); } });
  const t = parts.t && parts.t[0];
  const v1s = parts.v1 || [];
  if (!t || !v1s.length) return false;
  const expected = crypto.createHmac("sha256", secret).update(t + "." + payload).digest("hex");
  return v1s.some((v) => { try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v)); } catch { return false; } });
}

async function stripeGet(path) {
  const r = await fetch("https://api.stripe.com/v1/" + path, { headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY } });
  if (!r.ok) throw new Error("Stripe " + path + ": " + r.status + " " + (await r.text()));
  return r.json();
}
function tierFromLineItems(items) {
  for (const it of items || []) { const p = it.price || {}; if (p.type === "one_time" && TIER_BY_ONBOARD_CENTS[p.unit_amount]) return TIER_BY_ONBOARD_CENTS[p.unit_amount]; }
  for (const it of items || []) { const p = it.price || {}; if (TIER_BY_ONBOARD_CENTS[p.unit_amount]) return TIER_BY_ONBOARD_CENTS[p.unit_amount]; }
  return null;
}
async function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/" + path, { ...opts, headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (!r.ok) throw new Error("Supabase " + path + ": " + r.status + " " + (await r.text()));
  return r.status === 204 ? null : r.json();
}
async function gotrue(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/" + path, { ...opts, headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

async function sendWelcomeEmail(email, tier, actionLink) {
  const from = process.env.REMINDER_FROM_EMAIL || "welcome@meridianimplantadvisory.com";
  const name = process.env.REMINDER_FROM_NAME || "Meridian Implant Advisory";
  const label = TIER_LABEL[tier] || tier;
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#151B23;">
    <div style="background:#0F1E2E;padding:28px 32px;text-align:center;">
      <div style="font-family:Georgia,serif;color:#fff;font-size:22px;letter-spacing:.5px;">MERIDIAN <span style="color:#D9BD90;">IMPLANT ADVISORY</span></div>
    </div>
    <div style="padding:32px;">
      <p style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#8C6D42;font-weight:bold;margin:0 0 6px;">Welcome</p>
      <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:26px;color:#0F1E2E;margin:0 0 10px;">You're enrolled in ${label}.</h1>
      <p style="font-size:15px;line-height:1.6;color:#4A5568;">Thank you for becoming a Meridian client. Set your password to open your private portal and get started — it takes about a minute.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${actionLink}" style="background:#B8935F;color:#0F1E2E;text-decoration:none;font-weight:bold;padding:14px 30px;border-radius:4px;display:inline-block;">Set your password &amp; get started</a>
      </p>
      <p style="font-size:13px;line-height:1.6;color:#8A94A3;">If the button doesn't work, copy this link into your browser:<br>${actionLink}</p>
      <p style="font-size:13px;line-height:1.6;color:#8A94A3;">Once you're in, we'll ask a few quick questions about your practice so we can tailor everything to you.</p>
    </div>
  </div>`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: from, name: name }, to: [{ email: email }], subject: "Welcome to Meridian — set your password to get started", htmlContent: html })
  });
  if (!r.ok) throw new Error("Brevo: " + r.status + " " + (await r.text()));
}

export default async (req) => {
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!verifyStripeSig(payload, sig, process.env.STRIPE_WEBHOOK_SECRET)) return bad(400, "bad signature");

  let event;
  try { event = JSON.parse(payload); } catch { return bad(400, "bad json"); }
  if (event.type !== "checkout.session.completed") return ok("ignored");

  try {
    const sessionId = event.data.object.id;
    // Re-fetch with line items so we can read the tier from the real amounts.
    const s = await stripeGet("checkout/sessions/" + encodeURIComponent(sessionId) + "?expand[]=line_items.data.price");
    if (!(s.payment_status === "paid" || s.status === "complete")) return ok("not paid");
    const email = (s.customer_details && s.customer_details.email) || s.customer_email;
    const tier = tierFromLineItems(s.line_items && s.line_items.data);
    if (!email || !tier) return ok("missing email/tier");

    // Bronze is the book only: no implementation support, no portal, and so no
    // account at all. Creating one would leave a login that leads nowhere and a
    // profile row that every tier check downstream then has to special-case.
    // Recorded as a purchase, not provisioned as a client.
    if (tier === "bronze") {
      try {
        await sb("memberships?on_conflict=stripe_session_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([{ stripe_session_id: sessionId, email, tier }])
        });
      } catch (e) { /* best-effort: the sale is already recorded in Stripe */ }
      await sendWelcomeEmail(email, tier, null);
      return ok("bronze: book only, no account provisioned");
    }

    // #1 — create the account (or reuse) and stamp the tier.
    let userId;
    const rnd = crypto.randomBytes(24).toString("hex");
    const created = await gotrue("admin/users", { method: "POST", body: JSON.stringify({ email, password: rnd, email_confirm: true }) });
    if (created.ok) {
      userId = created.body.id;
    } else {
      const rows = await sb("profiles?select=id&email=eq." + encodeURIComponent(email));
      if (rows && rows.length) userId = rows[0].id; else throw new Error("could not create or find user " + email);
    }
    // Stamp the tier + record the purchase — best-effort, so a DB hiccup (e.g.
    // a not-yet-run migration) can never block the welcome email below.
    try {
      await sb("profiles?id=eq." + userId, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ membership_tier: tier, is_active: true }) });
    } catch (e) { console.error("stripe-webhook profile patch:", String((e && e.message) || e)); }
    try {
      await sb("memberships?on_conflict=stripe_session_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ user_id: userId, tier, stripe_session_id: sessionId, stripe_customer: s.customer || null, amount_total: s.amount_total || null }]) });
    } catch (e) { console.error("stripe-webhook membership insert:", String((e && e.message) || e)); }

    // #3 — generate a set-password link and send the branded welcome email.
    const site = process.env.SITE_URL || "https://meridianimplantadvisory.com";
    let actionLink = site + "/reset-password.html";
    try {
      const link = await gotrue("admin/generate_link", { method: "POST", body: JSON.stringify({ type: "recovery", email, redirect_to: site + "/reset-password.html" }) });
      actionLink = (link.body && (link.body.action_link || (link.body.properties && link.body.properties.action_link))) || actionLink;
    } catch (e) { console.error("stripe-webhook generate_link:", String((e && e.message) || e)); }
    await sendWelcomeEmail(email, tier, actionLink);

    return ok("provisioned");
  } catch (e) {
    // Return 200 so Stripe doesn't hammer retries on a non-signature error we've logged;
    // the nightly reconciliation (if enabled) or manual review will catch anything missed.
    console.error("stripe-webhook:", String((e && e.message) || e));
    return ok("logged-error");
  }
};
