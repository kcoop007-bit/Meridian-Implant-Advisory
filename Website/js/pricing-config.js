// ─────────────────────────────────────────────────────────────
// Membership pricing + Stripe Payment Links.
// Kevin: paste your three Stripe Payment Link URLs below (create them
// in the Stripe Dashboard — see "Membership Pricing Strategy.md" for
// step-by-step). Until a link is filled in, the button routes to the
// contact section so the page never shows a dead button.
//
// In Stripe, set each Payment Link's "After payment" to redirect to:
//   https://meridianimplantadvisory.com/onboarding.html
// so paying clients land on the onboarding questionnaire automatically.
// ─────────────────────────────────────────────────────────────
window.MERIDIAN_PRICING = {
  fallback: "/index.html#contact",
  tiers: {
    bronze: { stripeLink: "" },   // one-time $495
    silver: { stripeLink: "" },   // $1,950 onboarding + $395/mo
    gold:   { stripeLink: "" }    // $9,500 onboarding + $2,500/mo
  }
};
