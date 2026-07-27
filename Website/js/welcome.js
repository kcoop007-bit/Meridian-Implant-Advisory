// Powers welcome.html — the post-payment confirmation page.
// Confirms the Stripe payment (verify-session) and reassures the client that
// their account is created and a set-password email is on the way. The actual
// account creation + branded email happen server-side in the stripe-webhook
// function the instant payment clears, so this page is just confirmation.
(function () {
  var TIER_LABEL = { bronze: "Bronze · The Playbook", silver: "Silver · Playbook + Platform", gold: "Gold · Premium On-Site" };

  async function main() {
    var sid = new URLSearchParams(window.location.search).get("session_id");
    if (!sid) return fail("This page opens automatically after checkout.");
    try {
      var res = await fetch("/.netlify/functions/verify-session?session_id=" + encodeURIComponent(sid));
      var data = await res.json();
      if (!res.ok || !data.paid || !data.tier) return fail(data && data.error ? data.error : "We couldn't confirm this checkout as paid.");
      document.getElementById("wl-tier").textContent = TIER_LABEL[data.tier] || data.tier;
      if (data.email) document.getElementById("wl-email").textContent = data.email;
      hide("#loading"); show("#welcome");
    } catch (e) {
      fail("Something went wrong confirming your checkout.");
    }
  }

  function fail(msg) { hide("#loading"); show("#error-state"); var m = document.getElementById("error-msg"); if (m && msg) m.textContent = msg + " If you were charged, contact us and we'll get you set up right away."; }
  function show(s) { var e = document.querySelector(s); if (e) e.style.display = ""; }
  function hide(s) { var e = document.querySelector(s); if (e) e.style.display = "none"; }

  document.addEventListener("DOMContentLoaded", main);
})();
