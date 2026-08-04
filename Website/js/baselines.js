// Powers baselines.html — step 2 of intake, hard-gated before the KPI tracker.
//
// The one rule that governs this file: a number the practice does not track is
// stored as NULL, never 0. A zero baseline silently poisons every percentage the
// dashboard derives later (and "we don't count conversations yet" is the single
// most common honest answer). Every numeric field therefore has a "we don't
// track this yet" escape hatch, and blank means blank.
(function () {

  async function main() {
    var client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) { show("#not-configured"); hide("#loading"); return; }

    var auth = await window.MeridianAuth.requireLogin("/login.html");
    if (!auth.user) return;

    // Bronze never reaches the tracker, so it should never be asked for baselines.
    if (!window.MeridianAccess.canAccessPortal(auth.profile)) {
      window.location.replace("/account.html?noaccess=1");
      return;
    }

    hide("#loading"); show("#bl");
    wireDontKnow();

    var existing = await client.from("kpi_baselines").select("*").eq("user_id", auth.user.id).maybeSingle();
    if (existing.data) { document.getElementById("already-done").style.display = "block"; prefill(existing.data); }

    document.getElementById("bl-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitForm(client, auth.user);
    });
  }

  // A ticked "we don't track this yet" clears and disables its field, so a value
  // cannot be submitted alongside a claim that it isn't tracked.
  function wireDontKnow() {
    document.querySelectorAll("[data-dk]").forEach(function (box) {
      var target = document.getElementById(box.getAttribute("data-dk"));
      box.addEventListener("change", function () {
        if (!target) return;
        target.disabled = box.checked;
        if (box.checked) target.value = "";
      });
    });
  }

  function show(s) { var e = document.querySelector(s); if (e) e.style.display = ""; }
  function hide(s) { var e = document.querySelector(s); if (e) e.style.display = "none"; }

  // Blank -> null. Never 0. parseFloat("") is NaN, which would land in the
  // database as null anyway, but being explicit keeps the intent readable.
  function num(id) {
    var el = document.getElementById(id);
    if (!el || el.disabled) return null;
    var v = el.value.trim();
    if (v === "") return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function txt(id) { var e = document.getElementById(id); return e && e.value.trim() ? e.value.trim() : null; }
  function bool(id) {
    var v = txt(id);
    return v === "yes" ? true : v === "no" ? false : null;
  }
  function checked(id) { var e = document.getElementById(id); return !!(e && e.checked); }

  function setVal(id, v) {
    var e = document.getElementById(id);
    if (!e) return;
    if (v == null) {
      // Restore the "don't track" tick for a field that was left null.
      var box = document.querySelector('[data-dk="' + id + '"]');
      if (box) { box.checked = true; e.disabled = true; }
      return;
    }
    e.value = v;
  }

  function prefill(d) {
    setVal("bl-imp12", d.implants_placed_12mo);
    setVal("bl-imp1", d.implants_placed_last_mo);
    setVal("bl-arch12", d.full_arch_cases_12mo);
    setVal("bl-refout", d.referred_out_per_mo);
    setVal("bl-conv", d.conversations_last_mo);
    setVal("bl-cons", d.consults_last_mo);
    setVal("bl-acc", d.cases_accepted_last_mo);
    setVal("bl-fee-sl", d.fee_single_low);
    setVal("bl-fee-sh", d.fee_single_high);
    setVal("bl-fee-al", d.fee_arch_low);
    setVal("bl-fee-ah", d.fee_arch_high);
    setVal("bl-rev", d.implant_revenue_per_mo);
    setVal("bl-acv", d.avg_case_value);
    setVal("bl-t-imp", d.target_implants_per_mo);
    setVal("bl-t-acc", d.target_acceptance_pct);
    setVal("bl-vision", d.hard_vision);
    setVal("bl-90", d.win_in_90_days);
    setVal("bl-block", d.biggest_blocker);
    setVal("bl-finp", d.financing_provider);
    var fin = document.getElementById("bl-fin");
    if (fin && d.offers_financing != null) fin.value = d.offers_financing ? "yes" : "no";
    var t = d.tracks_funnel_today || {};
    if (document.getElementById("bl-tc-conv")) document.getElementById("bl-tc-conv").checked = !!t.conversations;
    if (document.getElementById("bl-tc-cons")) document.getElementById("bl-tc-cons").checked = !!t.consults;
    if (document.getElementById("bl-tc-acc")) document.getElementById("bl-tc-acc").checked = !!t.accepted;
  }

  async function submitForm(client, user) {
    var status = document.getElementById("bl-status");
    var lo = num("bl-fee-sl"), hi = num("bl-fee-sh");
    var alo = num("bl-fee-al"), ahi = num("bl-fee-ah");
    if (lo != null && hi != null && lo > hi) {
      status.textContent = "Single-implant low fee is higher than the high fee — please check.";
      status.style.color = "#B4423C"; return;
    }
    if (alo != null && ahi != null && alo > ahi) {
      status.textContent = "Full-arch low fee is higher than the high fee — please check.";
      status.style.color = "#B4423C"; return;
    }
    var cons = num("bl-cons"), acc = num("bl-acc");
    if (cons != null && acc != null && acc > cons) {
      status.textContent = "Cases accepted can't exceed consults held — please check those two.";
      status.style.color = "#B4423C"; return;
    }

    status.textContent = "Saving…"; status.style.color = "var(--text-faint)";

    var payload = {
      user_id: user.id,
      implants_placed_12mo:    num("bl-imp12"),
      implants_placed_last_mo: num("bl-imp1"),
      full_arch_cases_12mo:    num("bl-arch12"),
      referred_out_per_mo:     num("bl-refout"),
      conversations_last_mo:   num("bl-conv"),
      consults_last_mo:        cons,
      cases_accepted_last_mo:  acc,
      implant_revenue_per_mo:  num("bl-rev"),
      avg_case_value:          num("bl-acv"),
      fee_single_low: lo, fee_single_high: hi,
      fee_arch_low: alo,  fee_arch_high: ahi,
      offers_financing:        bool("bl-fin"),
      financing_provider:      txt("bl-finp"),
      tracks_funnel_today: {
        conversations: checked("bl-tc-conv"),
        consults:      checked("bl-tc-cons"),
        accepted:      checked("bl-tc-acc")
      },
      target_implants_per_mo:  num("bl-t-imp"),
      target_acceptance_pct:   num("bl-t-acc"),
      hard_vision:     txt("bl-vision"),
      win_in_90_days:  txt("bl-90"),
      biggest_blocker: txt("bl-block"),
      updated_at: new Date().toISOString()
    };

    var up = await client.from("kpi_baselines").upsert(payload, { onConflict: "user_id" });
    if (up.error) {
      status.textContent = "Couldn't save: " + up.error.message;
      status.style.color = "#B4423C";
      return;
    }

    // The v6 trigger seeds public.goals and stamps profiles.baselines_completed_at,
    // which is what releases the hard gate on the tracker.
    status.textContent = "Saved — building your tracker…";
    status.style.color = "#2E7D4F";
    setTimeout(function () { window.location.href = "/goals.html"; }, 1100);
  }

  document.addEventListener("DOMContentLoaded", main);
})();
