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
    await seedStarters(client, auth);
    await renderList();

    var restoreBtn = document.getElementById("restore-starters");
    if (restoreBtn) {
      restoreBtn.addEventListener("click", function () { restoreStarters(client, auth); });
    }
  }


  // Seed the starter schedule ONCE, and only when the account has no reminders
  // at all. Guarded further by a unique index on (user_id, template_key), so a
  // race or a double-click cannot produce duplicates — and a client who deletes
  // a reminder does not get it silently resurrected on their next visit.
  async function seedStarters(client, auth) {
    if (!window.MeridianReminderTemplates) return;
    if (!window.MeridianAccess.canAccessPortal(auth.profile)) return;
    var existing = await client.from("reminders").select("id").eq("user_id", auth.user.id).limit(1);
    if (existing.error || (existing.data && existing.data.length)) return;

    var email = (auth.profile && auth.profile.target_email) || auth.user.email;
    var rows = window.MeridianReminderTemplates.ALL.map(function (t) {
      return window.MeridianReminderTemplates.toRow(t, auth.user.id, email);
    });
    var ins = await client.from("reminders").insert(rows);
    if (ins.error) {
      // Surfaced, not swallowed. A console.warn here meant a failed seed looked
      // identical to "no starter reminders exist", which is exactly what went
      // wrong the first time this shipped.
      setStatus("Couldn't load the starter reminders: " + ins.error.message, "#B4423C");
      console.warn("seed failed:", ins.error);
    }
  }

  // Manual re-seed. The automatic one only fires when the account has NO
  // reminders at all, so anyone who had already created one — or hit a failed
  // seed — could never get the starters. The unique index on
  // (user_id, template_key) makes this safe to press repeatedly.
  async function restoreStarters(client, auth) {
    if (!window.MeridianReminderTemplates) {
      setStatus("Starter reminder templates didn't load — try a hard refresh.", "#B4423C");
      return;
    }
    setStatus("Loading starter reminders…");
    var email = (auth.profile && auth.profile.target_email) || auth.user.email;
    var rows = window.MeridianReminderTemplates.ALL.map(function (t) {
      return window.MeridianReminderTemplates.toRow(t, auth.user.id, email);
    });
    var res = await client.from("reminders")
      .upsert(rows, { onConflict: "user_id,template_key", ignoreDuplicates: true });
    if (res.error) {
      setStatus("Couldn't load them: " + res.error.message, "#B4423C");
      console.warn("restore failed:", res.error);
      return;
    }
    setStatus("Starter reminders loaded.", "#2E7D4F");
    renderList();
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
