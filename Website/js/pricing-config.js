// ─────────────────────────────────────────────────────────────
// Membership pricing + Stripe Payment Links.
// Kevin: paste your three Stripe Payment Link URLs below (create them
// in the Stripe Dashboard — see "Membership Pricing Strategy.md" for
// step-by-step). Until a link is filled in, the button routes to the
// contact section so the page never shows a dead button.
//
// In Stripe, set each Payment Link's "After payment" to redirect to:
//   https://meridianimplantadvisory.com/welcome.html?session_id={CHECKOUT_SESSION_ID}
// so paying clients land on the automated welcome/onboarding page, which
// verifies the payment and creates their account with the correct tier.
// ─────────────────────────────────────────────────────────────
window.MERIDIAN_PRICING = {
  fallback: "/index.html#contact",
  tiers: {
    bronze: { stripeLink: "https://buy.stripe.com/test_28E14nedZfIPayHfDR6Na00" },   // TEST — one-time $495
    silver: { stripeLink: "https://buy.stripe.com/test_9B65kD5Ht2W34aj0IX6Na01" },   // TEST — $1,950 onboarding + $395/mo
    gold:   { stripeLink: "https://buy.stripe.com/test_5kQdR92vh54bcGP0IX6Na03" }    // TEST — $9,500 onboarding + $2,500/mo
  }
  // NOTE: these are Stripe TEST links. Before going live, swap in the three
  // live (buy.stripe.com/…, no "test_") links and set Netlify's STRIPE_SECRET_KEY
  // + webhook to their live-mode values.
};
