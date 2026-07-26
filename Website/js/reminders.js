// Powers reminders.html: clients add / delete / toggle reminders on their
// account page. The Netlify function reminder-dispatch actually sends them.
(function () {
  var client, user, statusEl;
  var NEEDS_DAYS = { daily: true, custom: true };

  async function main() {
    client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) { show("#not-configured"); hide("#loading"); return; }
    var auth = await window.MeridianAuth.requireLogin("/login.html");
    if (!auth.user) return;
    user = auth.user;

    hide("#loading"); show("#panel");
    statusEl = document.getElementById("rf-status");
    document.getElementById("rf-email").placeholder = user.email;

    var freq = document.getElementById("rf-frequency");
    freq.addEventListener("change", toggleDays);
    toggleDays();

    document.getElementById("rem-form").addEventListener("submit", onAdd);
    await renderList();
  }

  function show(s){var e=document.querySelector(s);if(e)e.style.display="";}
  function hide(s){var e=document.querySelector(s);if(e)e.style.display="none";}
  function setStatus(m,c){statusEl.textContent=m||"";statusEl.style.color=c||"var(--text-faint)";}

  function toggleDays() {
    var freq = document.getElementById("rf-frequency").value;
    document.getElementById("rf-weekdays-wrap").style.display = NEEDS_DAYS[freq] ? "" : "none";
  }

  function selectedWeekdays() {
    var out = [];
    document.querySelectorAll("#rf-weekdays input:checked").forEach(function (c) { out.push(parseInt(c.value, 10)); });
    return out;
  }

  async function onAdd(e) {
    e.preventDefault();
    var freq = document.getElementById("rf-frequency").value;
    var wds = selectedWeekdays();
    if (NEEDS_DAYS[freq] && wds.length === 0) { setStatus("Pick at least one day.", "#B4423C"); return; }
    setStatus("Saving…");

    var payload = {
      user_id: user.id,
      title: document.getElementById("rf-title").value.trim(),
      category: document.getElementById("rf-category").value,
      channel: document.getElementById("rf-channel").value,
      frequency: freq,
      byweekday: NEEDS_DAYS[freq] ? wds : (freq === "weekly" ? [1] : null),
      day_of_month: 1,
      time_local: document.getElementById("rf-time").value || "07:00",
      timezone: "America/New_York",
      target_email: document.getElementById("rf-email").value.trim() || null,
      notes: document.getElementById("rf-notes").value.trim() || null,
      active: true
    };
    var res = await client.from("reminders").insert([payload]);
    if (res.error) { setStatus("Couldn't save: " + res.error.message, "#B4423C"); return; }
    setStatus("Reminder added.", "#2E7D4F");
    document.getElementById("rem-form").reset();
    document.getElementById("rf-time").value = "07:00";
    toggleDays();
    renderList();
  }

  async function renderList() {
    var res = await client.from("reminders").select("*").order("created_at", { ascending: false });
    var list = document.getElementById("rem-list");
    list.innerHTML = "";
    if (res.error) { list.innerHTML = '<p style="color:#B4423C;">' + res.error.message + "</p>"; return; }
    if (!res.data.length) { list.innerHTML = '<p style="color:var(--text-faint);">No reminders yet.</p>'; return; }

    res.data.forEach(function (r) {
      var card = document.createElement("div");
      card.className = "card rem-card";

      var left = document.createElement("div");
      var t = document.createElement("div");
      t.style.fontWeight = "600";
      t.textContent = r.title + (r.active ? "" : "  (paused)");
      if (!r.active) t.style.color = "var(--text-faint)";
      left.appendChild(t);
      var when = document.createElement("div");
      when.className = "rem-when";
      when.textContent = window.MeridianReminders.describe(r) + "  ·  " +
        (r.channel === "email" ? "Email" : r.channel === "calendar" ? "Calendar" : "Email + calendar") +
        (r.notes ? "  ·  " + r.notes : "");
      left.appendChild(when);
      card.appendChild(left);

      var right = document.createElement("div");
      right.style.cssText = "display:flex; gap:8px; align-items:center;";

      var toggle = document.createElement("button");
      toggle.className = "btn btn-outline-dark btn-sm";
      toggle.textContent = r.active ? "Pause" : "Resume";
      toggle.addEventListener("click", async function () {
        await client.from("reminders").update({ active: !r.active, updated_at: new Date().toISOString() }).eq("id", r.id);
        renderList();
      });
      right.appendChild(toggle);

      var del = document.createElement("button");
      del.className = "btn btn-outline-dark btn-sm";
      del.style.color = "#B4423C";
      del.textContent = "Delete";
      del.addEventListener("click", async function () {
        if (!confirm('Delete "' + r.title + '"?')) return;
        await client.from("reminders").delete().eq("id", r.id);
        renderList();
      });
      right.appendChild(del);

      card.appendChild(right);
      list.appendChild(card);
    });
  }

  document.addEventListener("DOMContentLoaded", main);
})();
