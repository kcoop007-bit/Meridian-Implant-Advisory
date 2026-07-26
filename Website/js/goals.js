// Powers goals.html: clients track goals/KPIs per time horizon with a
// baseline, target, current value, computed progress %, and notes; a Chart.js
// bar chart; and CSV / PDF export. Admins can view any account read-only via
// ?user=<id> (RLS "admins read all goals" allows the read).
(function () {
  var PERIODS = [
    { key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" },
    { key: "monthly", label: "Monthly" }, { key: "quarterly", label: "Quarterly" },
    { key: "yearly", label: "Yearly" }
  ];
  var client, viewerId, targetUserId, editable, chart, allGoals = [];

  async function main() {
    client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) { show("#not-configured"); hide("#loading"); return; }
    var auth = await window.MeridianAuth.requireLogin("/login.html");
    if (!auth.user) return;
    viewerId = auth.user.id;

    var isAdmin = auth.profile && auth.profile.role === "admin";
    var qUser = new URLSearchParams(window.location.search).get("user");
    if (qUser && isAdmin) {
      targetUserId = qUser; editable = false;
    } else {
      targetUserId = viewerId; editable = true;
    }

    hide("#loading"); show("#panel");

    if (!editable) {
      var banner = document.getElementById("admin-banner");
      banner.style.display = "block";
      banner.textContent = "Admin view — showing this client's goals (read-only).";
      document.getElementById("add-card").style.display = "none";
      document.getElementById("subtitle").textContent = "Read-only view of a client's goals and KPI progress.";
      // fetch the client's email for the banner
      client.from("profiles").select("email").eq("id", targetUserId).maybeSingle().then(function (r) {
        if (r.data) banner.textContent = "Admin view — goals for " + r.data.email + " (read-only).";
      });
    } else {
      document.getElementById("goal-form").addEventListener("submit", onAdd);
    }

    document.getElementById("export-csv").addEventListener("click", exportCsv);
    document.getElementById("export-pdf").addEventListener("click", function () { window.print(); });

    await load();
  }

  function show(s){var e=document.querySelector(s);if(e)e.style.display="";}
  function hide(s){var e=document.querySelector(s);if(e)e.style.display="none";}
  function num(v){return v==null||v===""?null:Number(v);}

  function progressPct(g) {
    var b = num(g.baseline), t = num(g.target), c = num(g.current);
    if (c == null || t == null) return null;
    if (b == null) b = 0;
    if (t === b) return c >= t ? 100 : 0;
    var pct = ((c - b) / (t - b)) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  async function load() {
    var res = await client.from("goals").select("*").eq("user_id", targetUserId)
      .order("period", { ascending: true }).order("created_at", { ascending: true });
    if (res.error) { document.getElementById("periods").innerHTML = '<p style="color:#B4423C;">' + res.error.message + "</p>"; return; }
    allGoals = res.data || [];
    renderPeriods();
    renderChart();
  }

  function renderPeriods() {
    var wrap = document.getElementById("periods");
    wrap.innerHTML = "";
    PERIODS.forEach(function (p) {
      var goals = allGoals.filter(function (g) { return g.period === p.key; });
      if (!goals.length && !editable) return;

      var block = document.createElement("div");
      block.className = "period-block";
      var h = document.createElement("h3");
      h.textContent = p.label + " goals";
      block.appendChild(h);

      if (!goals.length) {
        var none = document.createElement("p");
        none.style.cssText = "color:var(--text-faint); font-size:0.9rem;";
        none.textContent = "No " + p.label.toLowerCase() + " goals yet.";
        block.appendChild(none);
        wrap.appendChild(block);
        return;
      }

      var table = document.createElement("table");
      table.className = "kpi-table";
      table.innerHTML = "<thead><tr><th>Goal / KPI</th><th>Baseline</th><th>Target</th><th>Current</th><th>Progress</th><th>Notes</th>" + (editable ? "<th></th>" : "") + "</tr></thead>";
      var tb = document.createElement("tbody");
      goals.forEach(function (g) { tb.appendChild(renderRow(g)); });
      table.appendChild(tb);
      block.appendChild(table);
      wrap.appendChild(block);
    });
  }

  function renderRow(g) {
    var tr = document.createElement("tr");
    var pct = progressPct(g);
    var unit = g.unit ? " " + g.unit : "";

    function cell(html) { var td = document.createElement("td"); td.innerHTML = html; return td; }

    tr.appendChild(cell("<strong>" + escapeHtml(g.name) + "</strong>"));
    tr.appendChild(cell(g.baseline == null ? "—" : g.baseline + unit));
    tr.appendChild(cell(g.target == null ? "—" : g.target + unit));

    if (editable) {
      var curTd = document.createElement("td");
      var curInput = document.createElement("input");
      curInput.type = "number"; curInput.step = "any"; curInput.className = "narrow";
      curInput.value = g.current == null ? "" : g.current;
      curTd.appendChild(curInput);
      tr.appendChild(curTd);
    } else {
      tr.appendChild(cell(g.current == null ? "—" : g.current + unit));
    }

    var barTd = document.createElement("td");
    barTd.innerHTML = pct == null
      ? '<span style="color:var(--text-faint);">—</span>'
      : '<div style="display:flex;align-items:center;gap:8px;"><div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%;"></div></div><span style="font-size:0.82rem;color:var(--text-soft);">' + pct + '%</span></div>';
    tr.appendChild(barTd);

    if (editable) {
      var noteTd = document.createElement("td");
      var noteInput = document.createElement("input");
      noteInput.type = "text"; noteInput.value = g.notes || "";
      noteInput.placeholder = "why achieved / not";
      noteTd.appendChild(noteInput);
      tr.appendChild(noteTd);

      var actTd = document.createElement("td");
      var save = document.createElement("button");
      save.className = "btn btn-outline-dark btn-sm"; save.textContent = "Save";
      save.addEventListener("click", async function () {
        var upd = await client.from("goals").update({
          current: curInput.value === "" ? null : Number(curInput.value),
          notes: noteInput.value.trim() || null,
          updated_at: new Date().toISOString()
        }).eq("id", g.id);
        if (upd.error) { alert(upd.error.message); return; }
        load();
      });
      var del = document.createElement("button");
      del.className = "btn btn-outline-dark btn-sm"; del.style.color = "#B4423C"; del.style.marginLeft = "6px"; del.textContent = "×";
      del.title = "Delete goal";
      del.addEventListener("click", async function () {
        if (!confirm('Delete "' + g.name + '"?')) return;
        await client.from("goals").delete().eq("id", g.id);
        load();
      });
      actTd.appendChild(save); actTd.appendChild(del);
      tr.appendChild(actTd);
    } else {
      tr.appendChild(cell(g.notes ? escapeHtml(g.notes) : "—"));
    }

    return tr;
  }

  function renderChart() {
    var canvas = document.getElementById("kpi-chart");
    var withProgress = allGoals.filter(function (g) { return progressPct(g) != null; });
    if (!withProgress.length) {
      canvas.style.display = "none";
      document.getElementById("chart-empty").style.display = "block";
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    canvas.style.display = "";
    document.getElementById("chart-empty").style.display = "none";
    var labels = withProgress.map(function (g) { return g.name; });
    var data = withProgress.map(progressPct);
    if (chart) chart.destroy();
    chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: labels, datasets: [{ label: "Progress %", data: data, backgroundColor: "#B8935F", borderRadius: 4 }] },
      options: {
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + "%"; } } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  async function onAdd(e) {
    e.preventDefault();
    var status = document.getElementById("goal-status");
    status.textContent = "Saving…"; status.style.color = "var(--text-faint)";
    var res = await client.from("goals").insert([{
      user_id: viewerId,
      period: document.getElementById("gf-period").value,
      name: document.getElementById("gf-name").value.trim(),
      baseline: num(document.getElementById("gf-baseline").value),
      target: num(document.getElementById("gf-target").value),
      current: null,
      unit: document.getElementById("gf-unit").value.trim() || null
    }]);
    if (res.error) { status.textContent = res.error.message; status.style.color = "#B4423C"; return; }
    status.textContent = "Added."; status.style.color = "#2E7D4F";
    document.getElementById("goal-form").reset();
    load();
  }

  function exportCsv() {
    var rows = [["Period", "Goal/KPI", "Baseline", "Target", "Current", "Progress %", "Unit", "Notes"]];
    allGoals.forEach(function (g) {
      rows.push([g.period, g.name, g.baseline, g.target, g.current, progressPct(g), g.unit || "", (g.notes || "").replace(/\n/g, " ")]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "meridian-goals-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  document.addEventListener("DOMContentLoaded", main);
})();
