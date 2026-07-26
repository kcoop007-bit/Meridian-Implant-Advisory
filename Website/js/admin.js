// Powers admin.html: the admin "Accounts" hub. Lists every registered account;
// each one links to its own page (account.html?user=<id>) where access controls
// and that account's Goals & KPIs live. Admin-only.
(function () {
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
    if (profilesRes.error) { setStatus("Could not load accounts: " + profilesRes.error.message, "#B4423C"); return; }

    var listEl = document.getElementById("user-list");
    listEl.innerHTML = "";

    if (!profilesRes.data || profilesRes.data.length === 0) {
      listEl.innerHTML = '<p class="muted">No accounts have registered yet.</p>';
      return;
    }

    profilesRes.data.forEach(function (p) { listEl.appendChild(renderAccount(p)); });
  }

  function renderAccount(p) {
    var isAdmin = p.role === "admin";

    var card = document.createElement("a");
    card.className = "card user-card";
    card.href = "/account.html?user=" + p.id;
    card.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:16px; text-decoration:none; color:inherit;";

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
    card.appendChild(left);

    var right = document.createElement("div");
    right.style.cssText = "display:flex; align-items:center; gap:12px; flex-wrap:wrap;";

    if (isAdmin) {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Admin";
      right.appendChild(badge);
    } else if (p.is_active === false) {
      var pill = document.createElement("span");
      pill.className = "revoked-pill";
      pill.textContent = "Deactivated";
      right.appendChild(pill);
    }

    var open = document.createElement("span");
    open.className = "btn btn-outline-dark btn-sm";
    open.textContent = "Open account →";
    right.appendChild(open);

    card.appendChild(right);
    return card;
  }

  document.addEventListener("DOMContentLoaded", main);
})();
