// Powers booking.html: renders the practice's booking types (mapped to
// Calendly event links) and embeds Calendly inline when one is chosen.
// Admins can add/remove session types right here (no SQL needed).
(function () {
  var client, isAdmin;

  async function main() {
    client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) { show("#not-configured"); hide("#loading"); return; }
    var auth = await window.MeridianAuth.requireLogin("/login.html");
    if (!auth.user) return;
    isAdmin = auth.profile && auth.profile.role === "admin";

    hide("#loading"); show("#panel");
    if (isAdmin) {
      show("#admin-card");
      document.getElementById("type-form").addEventListener("submit", onAddType);
    }
    await renderTypes();
  }

  function show(s){var e=document.querySelector(s);if(e)e.style.display="";}
  function hide(s){var e=document.querySelector(s);if(e)e.style.display="none";}

  async function renderTypes() {
    var res = await client.from("booking_types").select("*")
      .order("sort_order", { ascending: true }).order("label", { ascending: true });
    var wrap = document.getElementById("type-cards");
    wrap.innerHTML = "";
    var noTypes = document.getElementById("no-types");

    if (res.error) { wrap.innerHTML = '<p style="color:#B4423C;">' + res.error.message + "</p>"; return; }
    var types = (res.data || []).filter(function (t) { return t.active !== false; });

    if (!types.length) {
      noTypes.style.display = "block";
      noTypes.textContent = isAdmin
        ? "No session types yet — add one below with its Calendly link."
        : "Booking isn't open yet — check back soon.";
      return;
    }
    noTypes.style.display = "none";

    types.forEach(function (t) {
      var card = document.createElement("div");
      card.className = "card";
      var h = document.createElement("h4");
      h.style.marginBottom = "4px";
      h.textContent = t.label + (t.duration_min ? "  ·  " + t.duration_min + " min" : "");
      card.appendChild(h);
      if (t.description) {
        var d = document.createElement("p");
        d.style.cssText = "color:var(--text-soft); font-size:0.9rem;";
        d.textContent = t.description;
        card.appendChild(d);
      }
      var btn = document.createElement("button");
      btn.className = "btn btn-primary btn-sm";
      btn.textContent = "Book " + t.label;
      btn.addEventListener("click", function () { openInline(t); });
      if (!t.calendly_url) { btn.disabled = true; btn.textContent = "Link not set yet"; }
      card.appendChild(btn);

      if (isAdmin) {
        var del = document.createElement("button");
        del.className = "btn btn-outline-dark btn-sm";
        del.style.cssText = "margin-left:8px; color:#B4423C;";
        del.textContent = "Remove";
        del.addEventListener("click", async function () {
          if (!confirm('Remove "' + t.label + '"?')) return;
          await client.from("booking_types").delete().eq("id", t.id);
          renderTypes();
        });
        card.appendChild(del);
      }
      wrap.appendChild(card);
    });
  }

  function openInline(t) {
    var container = document.getElementById("calendly-container");
    container.innerHTML = "";
    if (!window.Calendly) { container.innerHTML = '<p style="color:var(--text-faint);">Loading scheduler…</p>'; setTimeout(function () { openInline(t); }, 500); return; }
    window.Calendly.initInlineWidget({ url: t.calendly_url, parentElement: container });
    container.scrollIntoView({ behavior: "smooth" });
  }

  async function onAddType(e) {
    e.preventDefault();
    var status = document.getElementById("bt-status");
    status.textContent = "Saving…"; status.style.color = "var(--text-faint)";
    var dur = document.getElementById("bt-duration").value;
    var res = await client.from("booking_types").insert([{
      slug: document.getElementById("bt-slug").value.trim(),
      label: document.getElementById("bt-label").value.trim(),
      duration_min: dur === "" ? null : parseInt(dur, 10),
      calendly_url: document.getElementById("bt-url").value.trim() || null,
      description: document.getElementById("bt-desc").value.trim() || null,
      active: true
    }]);
    if (res.error) { status.textContent = res.error.message; status.style.color = "#B4423C"; return; }
    status.textContent = "Added."; status.style.color = "#2E7D4F";
    document.getElementById("type-form").reset();
    renderTypes();
  }

  document.addEventListener("DOMContentLoaded", main);
})();
