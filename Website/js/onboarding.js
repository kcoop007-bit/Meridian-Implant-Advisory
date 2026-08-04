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
      setVal("ob-practice", d.practice_name);   setVal("ob-address", d.office_address);
      setVal("ob-phone", d.office_phone);       setVal("ob-website", d.website_url);
      setVal("ob-tz", d.time_zone);             setVal("ob-pms", d.pms_software);
      setVal("ob-active", d.active_patient_count); setVal("ob-ops", d.operatories);
      setVal("ob-days", d.days_open_per_week);  setVal("ob-placers", d.num_implant_placers);
      setVal("ob-imp12", d.implants_placed_last_12mo);
      setVal("ob-refpartners", d.referral_partners);
      setVal("ob-om-name", d.office_manager_name);   setVal("ob-om-email", d.office_manager_email);
      setVal("ob-om-cell", d.office_manager_cell);   setVal("ob-clin-name", d.clinician_name);
      setVal("ob-clin-email", d.clinician_email);    setVal("ob-clin-cell", d.clinician_cell);
      setVal("ob-windows", d.preferred_meeting_windows);
      setVal("ob-success", d.success_in_6_months);
      setVal("ob-refout", d.refers_implants_out === true ? "yes" : d.refers_implants_out === false ? "no" : "");
      setVal("ob-om", d.has_office_manager === true ? "yes" : d.has_office_manager === false ? "no" : "");
      var tech = d.technology || {};
      ["cbct","scanner","guided","mill"].forEach(function (k) {
        var el = document.getElementById("ob-" + k); if (el) el.checked = !!tech[k];
      });
      if (Array.isArray(d.team_access)) {
        setVal("ob-team", d.team_access.map(function (t) {
          return [t.name, t.email].filter(Boolean).join(" ");
        }).join("\n"));
      }
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


  function intOrNull(id) { var v = val(id); if (v === "") return null; var n = parseInt(v, 10); return isFinite(n) ? n : null; }
  function numOrNull(id) { var v = val(id); if (v === "") return null; var n = parseFloat(v); return isFinite(n) ? n : null; }
  function yesNo(id) { var v = val(id); return v === "yes" ? true : v === "no" ? false : null; }
  function isChecked(id) { var e = document.getElementById(id); return !!(e && e.checked); }

  // "Jane Doe jane@practice.com" per line -> [{name, email}]. Deliberately
  // forgiving: this is a convenience list for issuing logins, not a validated
  // contact record, and a rejected format here would block onboarding.
  function parseTeam(text) {
    if (!text) return null;
    var rows = text.split(/\n+/).map(function (line) {
      var m = line.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      var email = m ? m[0] : null;
      var name = (email ? line.replace(email, "") : line).replace(/[,;]/g, " ").trim();
      return (name || email) ? { name: name || null, email: email } : null;
    }).filter(Boolean);
    return rows.length ? rows : null;
  }

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

      practice_name: val("ob-practice") || null,
      office_address: val("ob-address") || null,
      office_phone: val("ob-phone") || null,
      website_url: val("ob-website") || null,
      time_zone: val("ob-tz") || null,
      pms_software: val("ob-pms") || null,
      active_patient_count: intOrNull("ob-active"),
      operatories: intOrNull("ob-ops"),
      days_open_per_week: numOrNull("ob-days"),
      num_implant_placers: intOrNull("ob-placers"),
      implants_placed_last_12mo: intOrNull("ob-imp12"),
      refers_implants_out: yesNo("ob-refout"),
      referral_partners: val("ob-refpartners") || null,
      has_office_manager: yesNo("ob-om"),
      office_manager_name: val("ob-om-name") || null,
      office_manager_email: val("ob-om-email") || null,
      office_manager_cell: val("ob-om-cell") || null,
      clinician_name: val("ob-clin-name") || null,
      clinician_email: val("ob-clin-email") || null,
      clinician_cell: val("ob-clin-cell") || null,
      preferred_meeting_windows: val("ob-windows") || null,
      success_in_6_months: val("ob-success") || null,
      technology: {
        cbct: isChecked("ob-cbct"), scanner: isChecked("ob-scanner"),
        guided: isChecked("ob-guided"), mill: isChecked("ob-mill")
      },
      team_access: parseTeam(val("ob-team")),

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
