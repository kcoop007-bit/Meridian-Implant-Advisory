// Powers account.html: an admin's view of a single registered account, opened
// as account.html?user=<id> from the Accounts list. Shows the account's profile,
// its resource-access controls (Account active + per-scope), and a link to that
// account's Goals & KPIs. Writes profiles.is_active and the entitlements table;
// the RLS in supabase-schema-v2.sql makes changes take effect immediately.
// Admin-only.
(function () {
  var SCOPES = [
    { key: "general", label: "General" },
    { key: "gp", label: "GP resources" },
    { key: "specialist", label: "Specialist resources" }
  ];

  var client, statusEl, targetId, profile, ents = [];

  async function main() {
    client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) { show("#not-configured"); hide("#loading"); return; }

    var auth = await window.MeridianAuth.requireLogin("/login.html");
    if (!auth.user) return;

    hide("#loading");
    if (!auth.profile || auth.profile.role !== "admin") { show("#denied"); return; }

    targetId = new URLSearchParams(window.location.search).get("user");
    if (!targetId) { show("#denied"); return; }

    show("#panel");
    statusEl = document.getElementById("status");
    document.getElementById("goals-link").href = "/goals.html?user=" + targetId;

    await load();
  }

  function show(sel) { var el = document.querySelector(sel); if (el) el.style.display = ""; }
  function hide(sel) { var el = document.querySelector(sel); if (el) el.style.display = "none"; }
  function setStatus(msg, color) { if (statusEl) { statusEl.textContent = msg || ""; statusEl.style.color = color || "var(--text-faint)"; } }

  async function load() {
    var pRes = await client.from("profiles").select("*").eq("id", targetId).maybeSingle();
    if (pRes.error) { setStatus("Could not load account: " + pRes.error.message, "#B4423C"); return; }
    if (!pRes.data) { setStatus("Account not found.", "#B4423C"); return; }
    profile = pRes.data;

    var eRes = await client.from("entitlements").select("*").eq("user_id", targetId);
    if (eRes.error) { setStatus("Could not load access: " + eRes.error.message, "#B4423C"); return; }
    ents = eRes.data || [];

    renderProfile();
    renderAccess();
  }

  function renderProfile() {
    document.getElementById("acct-title").textContent = profile.email || "(no email)";
    document.getElementById("acct-sub").textContent =
      (profile.role === "admin" ? "Administrator account" : "Client account");

    var kv = [
      ["Full name", profile.full_name],
      ["Practice", profile.practice_name],
      ["Client type", profile.client_type ? profile.client_type.toUpperCase() : null],
      ["Status", profile.role === "admin" ? "Admin" : (profile.is_active === false ? "Deactivated" : "Active")]
    ];
    var html = kv.map(function (r) {
      return '<div class="kv"><span class="k">' + r[0] + '</span><span>' + escapeHtml(r[1] || "—") + "</span></div>";
    }).join("");
    document.getElementById("profile-card").innerHTML = html;
  }

  function isDenied(scope) {
    return ents.some(function (e) {
      return e.granted === false && e.revoked_at != null && (e.scope === scope || e.scope === "all");
    });
  }

  function renderAccess() {
    // Admins have no access controls (they see everything by role).
    if (profile.role === "admin") { document.getElementById("access-card").style.display = "none"; return; }
    document.getElementById("access-card").style.display = "";

    var wrap = document.getElementById("access-controls");
    wrap.innerHTML = "";

    // Account-active switch
    var actRow = document.createElement("div");
    actRow.className = "access-row";
    var actLabel = document.createElement("label");
    var actCb = document.createElement("input");
    actCb.type = "checkbox";
    actCb.checked = profile.is_active !== false;
    actCb.addEventListener("change", function () { setAccountActive(actCb); });
    actLabel.appendChild(actCb);
    actLabel.appendChild(document.createTextNode("Account active"));
    actRow.appendChild(actLabel);
    wrap.appendChild(actRow);

    // Per-scope access
    var row = document.createElement("div");
    row.className = "access-row";
    var lead = document.createElement("span");
    lead.className = "muted";
    lead.textContent = "Access to:";
    row.appendChild(lead);

    SCOPES.forEach(function (s) {
      var lbl = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !isDenied(s.key);
      cb.disabled = profile.is_active === false; // whole account off => scope toggles moot
      cb.addEventListener("change", function () { setScopeAccess(s.key, cb); });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(" " + s.label));
      row.appendChild(lbl);
    });
    wrap.appendChild(row);
  }

  async function setAccountActive(cb) {
    setStatus("Saving…");
    var res = await client.from("profiles").update({ is_active: cb.checked }).eq("id", targetId);
    if (res.error) { setStatus("Failed: " + res.error.message, "#B4423C"); cb.checked = !cb.checked; return; }
    profile.is_active = cb.checked;
    setStatus((cb.checked ? "Reactivated " : "Deactivated ") + (profile.email || "account") + ".", "#2E7D4F");
    renderProfile();
    renderAccess(); // refresh disabled-states of scope toggles
  }

  async function setScopeAccess(scope, cb) {
    setStatus("Saving…");
    var res;
    if (cb.checked) {
      res = await client.from("entitlements").delete().eq("user_id", targetId).eq("scope", scope);
    } else {
      res = await client.from("entitlements").upsert(
        { user_id: targetId, scope: scope, granted: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: "user_id,scope" }
      );
    }
    if (res.error) { setStatus("Failed: " + res.error.message, "#B4423C"); cb.checked = !cb.checked; return; }
    // keep local ents in sync so a later toggle reads correctly
    ents = ents.filter(function (e) { return e.scope !== scope; });
    if (!cb.checked) ents.push({ user_id: targetId, scope: scope, granted: false, revoked_at: new Date().toISOString() });
    setStatus((cb.checked ? "Granted " : "Revoked ") + scope + " for " + (profile.email || "account") + ".", "#2E7D4F");
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  document.addEventListener("DOMContentLoaded", main);
})();
