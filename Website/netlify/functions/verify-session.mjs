// GET /.netlify/functions/verify-session?session_id=cs_...
// Confirms a Stripe Checkout Session was paid and returns the tier + email,
// with the tier DERIVED FROM THE ACTUAL PAYMENT (the one-time onboarding
// line-item amount) — not from anything the browser can spoof.
//
// Required Netlify env var:
//   STRIPE_SECRET_KEY   (sk_live_… or sk_test_…)
//
// Tier is matched off the one-time onboarding amount. If you change prices,
// update TIER_BY_ONBOARD_CENTS here to match.

const TIER_BY_ONBOARD_CENTS = { 49500: "bronze", 195000: "silver", 950000: "gold" };

async function stripeGet(path) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY }
  });
  if (!r.ok) throw new Error("Stripe " + path + ": " + r.status + " " + (await r.text()));
  return r.json();
}

export function tierFromSession(session) {
  const items = (session.line_items && session.line_items.data) || [];
  // Prefer the one-time onboarding line item.
  for (const it of items) {
    const p = it.price || {};
    if (p.type === "one_time" && TIER_BY_ONBOARD_CENTS[p.unit_amount]) return TIER_BY_ONBOARD_CENTS[p.unit_amount];
  }
  // Fallback: any line item whose amount matches a known onboarding price (Bronze).
  for (const it of items) {
    const p = it.price || {};
    if (TIER_BY_ONBOARD_CENTS[p.unit_amount]) return TIER_BY_ONBOARD_CENTS[p.unit_amount];
  }
  return null;
}

function json(o, code = 200) {
  return new Response(JSON.stringify(o), { status: code, headers: { "Content-Type": "application/json" } });
}

export default async (req) => {
  const sid = new URL(req.url).searchParams.get("session_id");
  if (!sid) return json({ error: "missing session_id" }, 400);
  try {
    const s = await stripeGet("checkout/sessions/" + encodeURIComponent(sid) + "?expand[]=line_items.data.price");
    const paid = s.payment_status === "paid" || s.status === "complete";
    return json({
      paid: paid,
      tier: tierFromSession(s),
      email: (s.customer_details && s.customer_details.email) || s.customer_email || null
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};
