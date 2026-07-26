// Powers admin.html: admin-only dashboard to grant/revoke resource access
// per client. Writes to profiles.is_active and the entitlements table; the
// RLS in supabase-schema-v2.sql makes revocation take effect immediately.
(function () {
  var SCOPES = [
    { key: "general", label: "General" },
    { key: "gp", label: "GP resources" },
    { key: "specialist", label: "Specialist resources" }
  ];

  var client, statusEl;

  async function main() {
    client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) { show("#not-configured"); hide("#loading"); return; }

    var auth = await window.MeridianAuth.requireLogin("/login.html");
    if (!auth.user) return;

    hide("#loading");
    if (!auth.profile || auth.profile.role !== "admin") { show("#denied"); return; }

    show("#panel");
    statusEl = document.getElementById("status");
    await render();
  }

  function show(sel) { var el = document.querySelector(sel); if (el) el.style.display = ""; }
  function hide(sel) { var el = document.querySelector(sel); if (el) el.style.display = "none"; }
  function setStatus(msg, color) { if (statusEl) { statusEl.textContent = msg || ""; statusEl.style.color = color || "var(--text-faint)"; } }

  async function render() {
    var profilesRes = await client.from("profiles").select("*").order("email", { ascending: true });
    if (profilesRes.error) { setStatus("Could not load users: " + profilesRes.error.message, "#B4423C"); return; }
    var entRes = await client.from("entitlements").select("*");
    if (entRes.error) { setStatus("Could not load entitlements: " + entRes.error.message, "#B4423C"); return; }

    var entByUser = {};
    (entRes.data || []).forEach(function (e) { (entByUser[e.user_id] = entByUser[e.user_id] || []).push(e); });

    var listEl = document.getElementById("user-list");
    listEl.innerHTML = "";

    profilesRes.data.forEach(function (p) {
      listEl.appendChild(renderUser(p, entByUser[p.id] || []));
    });

    if (profilesRes.data.length === 0) {
      listEl.innerHTML = '<p class="muted">No user accounts yet.</p>';
    }
  }

  function isDenied(ents, scope) {
    return ents.some(function (e) {
      return e.granted === false && e.revoked_at != null && (e.scope === scope || e.scope === "all");
    });
  }

  function renderUser(p, ents) {
    var card = document.createElement("div");
    card.className = "card user-card";

    var isAdmin = p.role === "admin";

    var top = document.createElement("div");
    top.className = "user-top";

    var left = document.createElement("div");
    var name = document.createElement("div");
    name.style.fontWeight = "600";
    name.textContent = p.email || "(no email)";
    left.appendChild(name);
    var meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = [p.full_name, p.practice_name, p.client_type ? p.client_type.toUpperCase() : null]
      .filter(Boolean).join(" · ") || "—";
    left.appendChild(meta);
    top.appendChild(left);

    var right = document.createElement("div");
    right.style.cssText = "display:flex; align-items:center; gap:10px; flex-wrap:wrap;";

    var goalsLink = document.createElement("a");
    goalsLink.className = "btn btn-outline-dark btn-sm";
    goalsLink.href = "/goals.html?user=" + p.id;
    goalsLink.textContent = "View goals →";
    right.appendChild(goalsLink);

    if (isAdmin) {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Admin";
      right.appendChild(badge);
    } else {
      // Account active switch
      var actLabel = document.createElement("label");
      actLabel.style.cssText = "display:flex; align-items:center; gap:7px; font-size:0.88rem; color:var(--text-soft); cursor:pointer; margin:0;";
      var actCb = document.createElement("input");
      actCb.type = "checkbox";
      actCb.style.width = "auto";
      actCb.checked = p.is_active !== false;
      actCb.addEventListener("change", function () { setAccountActive(p, actCb); });
      actLabel.appendChild(actCb);
      actLabel.appendChild(document.createTextNode("Account active"));
      right.appendChild(actLabel);
    }
    top.appendChild(right);
    card.appendChild(top);

    if (!isAdmin) {
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
        cb.checked = !isDenied(ents, s.key);
        cb.disabled = p.is_active === false; // whole account off => scope toggles moot
        cb.addEventListener("change", function () { setScopeAccess(p, s.key, cb); });
        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(" " + s.label));
        row.appendChild(lbl);
      });
      card.appendChild(row);
    }

    return card;
  }

  async function setAccountActive(p, cb) {
    setStatus("Saving…");
    var res = await client.from("profiles").update({ is_active: cb.checked }).eq("id", p.id);
    if (res.error) { setStatus("Failed: " + res.error.message, "#B4423C"); cb.checked = !cb.checked; return; }
    setStatus((cb.checked ? "Reactivated " : "Deactivated ") + p.email + ".", "#2E7D4F");
    render(); // refresh disabled-states
  }

  async function setScopeAccess(p, scope, cb) {
    setStatus("Saving…");
    var res;
    if (cb.checked) {
      // grant: remove the deny row
      res = await client.from("entitlements").delete().eq("user_id", p.id).eq("scope", scope);
    } else {
      // revoke: upsert a deny row
      res = await client.from("entitlements").upsert(
        { user_id: p.id, scope: scope, granted: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: "user_id,scope" }
      );
    }
    if (res.error) { setStatus("Failed: " + res.error.message, "#B4423C"); cb.checked = !cb.checked; return; }
    setStatus((cb.checked ? "Granted " : "Revoked ") + scope + " for " + p.email + ".", "#2E7D4F");
  }

  document.addEventListener("DOMContentLoaded", main);
})();
