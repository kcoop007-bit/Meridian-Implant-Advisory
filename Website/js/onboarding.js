// Powers onboarding.html: the practice questionnaire + mandatory waiver.
// Submit is blocked until the waiver is accepted. Writes onboarding_responses
// (upsert, so clients can update) and appends an immutable waiver_acceptances row.
(function () {
  var WAIVER_VERSION = "v1-2026-07"; // bump when the waiver text changes

  async function main() {
    var client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) { show("#not-configured"); hide("#loading"); return; }

    var auth = await window.MeridianAuth.requireLogin("/login.html");
    if (!auth.user) return;

    hide("#loading");
    show("#onboard");
    document.getElementById("user-email").textContent = auth.user.email;

    var accept = document.getElementById("ob-accept");
    var submit = document.getElementById("ob-submit");
    accept.addEventListener("change", function () { submit.disabled = !accept.checked; });

    // Prefill if they've onboarded before.
    var existing = await client.from("onboarding_responses").select("*").eq("user_id", auth.user.id).maybeSingle();
    if (existing.data) {
      document.getElementById("already-done").style.display = "block";
      var d = existing.data;
      setVal("ob-goals", d.goals);
      setVal("ob-bottlenecks", d.bottlenecks);
      setVal("ob-doctors", d.num_doctors);
      setVal("ob-tc", d.has_treatment_coordinator === true ? "yes" : d.has_treatment_coordinator === false ? "no" : "");
      setVal("ob-staff", d.staff_structure && d.staff_structure.summary);
      setVal("ob-prior", d.prior_systems);
    }

    document.getElementById("onboard-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitForm(client, auth.user);
    });
  }

  function show(sel) { var el = document.querySelector(sel); if (el) el.style.display = ""; }
  function hide(sel) { var el = document.querySelector(sel); if (el) el.style.display = "none"; }
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  function setVal(id, v) { var el = document.getElementById(id); if (el && v != null) el.value = v; }

  async function submitForm(client, user) {
    var status = document.getElementById("ob-status");
    if (!document.getElementById("ob-accept").checked) {
      status.textContent = "Please accept the waiver to continue.";
      status.style.color = "#B4423C";
      return;
    }
    status.textContent = "Saving…";
    status.style.color = "var(--text-faint)";

    var tc = val("ob-tc");
    var doctors = val("ob-doctors");
    var staffSummary = val("ob-staff");

    var payload = {
      user_id: user.id,
      goals: val("ob-goals"),
      bottlenecks: val("ob-bottlenecks"),
      num_doctors: doctors === "" ? null : parseInt(doctors, 10),
      has_treatment_coordinator: tc === "" ? null : tc === "yes",
      staff_structure: staffSummary ? { summary: staffSummary } : null,
      prior_systems: val("ob-prior"),
      raw: {
        goals: val("ob-goals"),
        bottlenecks: val("ob-bottlenecks"),
        num_doctors: doctors,
        treatment_coordinator: tc,
        staff_summary: staffSummary,
        prior_systems: val("ob-prior")
      },
      updated_at: new Date().toISOString()
    };

    var up = await client.from("onboarding_responses").upsert(payload, { onConflict: "user_id" });
    if (up.error) { status.textContent = "Couldn't save: " + up.error.message; status.style.color = "#B4423C"; return; }

    // Immutable acceptance record.
    var wa = await client.from("waiver_acceptances").insert([{
      user_id: user.id,
      waiver_version: WAIVER_VERSION,
      user_agent: navigator.userAgent
    }]);
    if (wa.error) { status.textContent = "Saved answers, but couldn't record acceptance: " + wa.error.message; status.style.color = "#B4423C"; return; }

    status.textContent = "All set — thank you! Redirecting to your resources…";
    status.style.color = "#2E7D4F";
    setTimeout(function () { window.location.href = "/resources.html"; }, 1200);
  }

  document.addEventListener("DOMContentLoaded", main);
})();
