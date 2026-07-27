// Powers resources.html: auth-gated resource library.
// Admin: drag-and-drop upload with document-type (Staff/Patient), training
// module, and a "pin to top" flag. Everyone: browse/download, organized as
//   1) Pinned modules (e.g. Training Booklet) — absolute top of the page
//   2) Staff Documents   — grouped by training module
//   3) Patient Documents — grouped by training module
//   4) General           — anything left untagged (nothing gets hidden)
(function () {
  var CATEGORY_LABELS = { general: "General", gp: "For General Dentists", specialist: "For Specialists" };
  var PINNED_MODULE = "Training Booklet"; // always floats to the very top

  async function main() {
    var client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) { show("#not-configured"); hide("#loading"); return; }

    var auth = await window.MeridianAuth.requireLogin("/login.html");
    if (!auth.user) return; // requireLogin already redirected

    // First-login onboarding gate: a non-admin client who hasn't completed the
    // onboarding questionnaire is sent there before seeing the portal.
    var isAdminEarly = auth.profile && auth.profile.role === "admin";
    if (!isAdminEarly) {
      var ob = await client.from("onboarding_responses").select("user_id").eq("user_id", auth.user.id).maybeSingle();
      if (!ob.error && !ob.data) { window.location.href = "/onboarding.html"; return; }
    }

    hide("#loading");
    show("#portal");

    document.getElementById("user-email").textContent = auth.user.email;
    document.getElementById("logout-btn").addEventListener("click", function () {
      window.MeridianAuth.logout();
    });

    var isAdmin = auth.profile && auth.profile.role === "admin";
    if (isAdmin) {
      show("#admin-panel");
      wireUpload(client);
      var eb = document.getElementById("portal-eyebrow");
      if (eb) eb.textContent = "Admin Portal";
      var pt = document.getElementById("portal-title");
      if (pt) pt.textContent = "Resources";
    }

    await loadResources(client, auth.profile, isAdmin);
  }

  function show(sel) { var el = document.querySelector(sel); if (el) el.style.display = ""; }
  function hide(sel) { var el = document.querySelector(sel); if (el) el.style.display = "none"; }

  async function loadResources(client, profile, isAdmin) {
    var res = await client
      .from("resources")
      .select("*")
      .order("pinned", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("uploaded_at", { ascending: false });

    var list = document.getElementById("resource-list");
    list.innerHTML = "";

    if (res.error) {
      list.innerHTML = '<p style="color:#B4423C;">Could not load resources: ' + res.error.message + "</p>";
      return;
    }

    // Visibility: admins see all; clients see general + their own client_type.
    // (Server RLS also enforces this + any revoked access — this is belt-and-suspenders.)
    var visible = res.data.filter(function (r) {
      if (isAdmin) return true;
      if (r.category === "general") return true;
      return profile && r.category === profile.client_type;
    });

    if (visible.length === 0) {
      list.innerHTML = '<p style="color:var(--text-faint);">No resources here yet — check back soon.</p>';
      return;
    }

    // Partition: pinned first, then Staff / Patient / General.
    var pinned = [], staff = [], patient = [], general = [];
    visible.forEach(function (r) {
      if (r.pinned || r.module === PINNED_MODULE) { pinned.push(r); return; }
      if (r.audience === "staff") staff.push(r);
      else if (r.audience === "patient") patient.push(r);
      else general.push(r);
    });

    if (pinned.length) list.appendChild(renderBand(pinned, PINNED_MODULE, true, profile, isAdmin, client));
    if (staff.length) list.appendChild(renderBand(staff, "Staff Documents", false, profile, isAdmin, client));
    if (patient.length) list.appendChild(renderBand(patient, "Patient Documents", false, profile, isAdmin, client));
    if (general.length) list.appendChild(renderBand(general, "General", false, profile, isAdmin, client));
  }

  // A top-level band (Pinned / Staff / Patient / General), with files grouped
  // by training module inside it.
  function renderBand(items, bandLabel, isPinnedBand, profile, isAdmin, client) {
    var band = document.createElement("div");
    band.style.marginBottom = "52px";

    var head = document.createElement("div");
    head.style.cssText = "display:flex; align-items:center; gap:12px; margin-bottom:18px;";
    var h = document.createElement("h3");
    h.style.margin = "0";
    h.textContent = bandLabel;
    head.appendChild(h);
    if (isPinnedBand) {
      var pin = document.createElement("span");
      pin.className = "badge";
      pin.textContent = "Pinned";
      head.appendChild(pin);
    }
    band.appendChild(head);

    // group by module
    var groups = {};
    items.forEach(function (r) {
      var key = r.module || "";
      (groups[key] = groups[key] || []).push(r);
    });
    // module order: pinned module first, then alphabetical, untagged ("") last
    var keys = Object.keys(groups).sort(function (a, b) {
      if (a === PINNED_MODULE) return -1;
      if (b === PINNED_MODULE) return 1;
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });

    keys.forEach(function (mod) {
      if (mod && !(isPinnedBand && mod === PINNED_MODULE)) {
        var mh = document.createElement("h4");
        mh.style.cssText = "margin:22px 0 10px; color:var(--text-soft);";
        mh.textContent = mod;
        band.appendChild(mh);
      }
      groups[mod].forEach(function (r) { band.appendChild(renderRow(r, isAdmin, client, profile)); });
    });

    return band;
  }

  function renderRow(r, isAdmin, client, profile) {
    var row = document.createElement("div");
    row.className = "card";
    row.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:18px 22px; margin-bottom:10px;";

    var left = document.createElement("div");
    var title = document.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = r.title;
    left.appendChild(title);
    if (r.description) {
      var desc = document.createElement("div");
      desc.style.cssText = "color:var(--text-faint); font-size:0.85rem; margin-top:2px;";
      desc.textContent = r.description;
      left.appendChild(desc);
    }
    row.appendChild(left);

    var right = document.createElement("div");
    right.style.cssText = "display:flex; gap:10px; align-items:center;";

    var dl = document.createElement("button");
    dl.className = "btn btn-outline-dark btn-sm";
    dl.textContent = "Download";
    dl.addEventListener("click", async function () {
      var c2 = window.getSupabaseClient();
      var signed = await c2.storage.from("resources").createSignedUrl(r.file_path, 60);
      if (signed.error) { alert("Couldn't generate a download link: " + signed.error.message); return; }
      window.open(signed.data.signedUrl, "_blank");
    });
    right.appendChild(dl);

    if (isAdmin) {
      var del = document.createElement("button");
      del.className = "btn btn-outline-dark btn-sm";
      del.textContent = "Remove";
      del.style.color = "#B4423C";
      del.addEventListener("click", async function () {
        if (!confirm('Remove "' + r.title + '"? This can\'t be undone.')) return;
        var c3 = window.getSupabaseClient();
        await c3.storage.from("resources").remove([r.file_path]);
        await c3.from("resources").delete().eq("id", r.id);
        loadResources(c3, profile, true);
      });
      right.appendChild(del);
    }

    row.appendChild(right);
    return row;
  }

  function wireUpload(client) {
    var zone = document.getElementById("drop-zone");
    var input = document.getElementById("file-input");
    var titleInput = document.getElementById("up-title");
    var descInput = document.getElementById("up-desc");
    var categorySelect = document.getElementById("up-category");
    var audienceSelect = document.getElementById("up-audience");
    var moduleInput = document.getElementById("up-module");
    var pinnedInput = document.getElementById("up-pinned");
    var status = document.getElementById("upload-status");
    var pendingFile = null;

    function setFile(file) {
      pendingFile = file;
      zone.querySelector(".dz-text").textContent = file ? file.name : "Drag a file here, or click to browse";
      if (file && !titleInput.value) titleInput.value = file.name.replace(/\.[a-zA-Z0-9]+$/, "");
    }

    zone.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () { setFile(input.files[0] || null); });
    ["dragenter", "dragover"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.add("dz-active"); });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.remove("dz-active"); });
    });
    zone.addEventListener("drop", function (e) {
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) setFile(file);
    });

    document.getElementById("upload-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!pendingFile) { status.textContent = "Choose a file first."; status.style.color = "#B4423C"; return; }
      status.textContent = "Uploading..."; status.style.color = "var(--text-faint)";

      var path = Date.now() + "-" + pendingFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      var up = await client.storage.from("resources").upload(path, pendingFile);
      if (up.error) { status.textContent = "Upload failed: " + up.error.message; status.style.color = "#B4423C"; return; }

      var rowErr = (await client.from("resources").insert([{
        title: titleInput.value.trim() || pendingFile.name,
        description: descInput.value.trim(),
        file_path: path,
        category: categorySelect.value,
        audience: audienceSelect.value || null,
        module: moduleInput.value.trim() || null,
        pinned: !!pinnedInput.checked
      }])).error;
      if (rowErr) { status.textContent = "Saved file, but failed to record it: " + rowErr.message; status.style.color = "#B4423C"; return; }

      status.textContent = "Uploaded."; status.style.color = "#2E7D4F";
      document.getElementById("upload-form").reset();
      setFile(null);
      var auth = await window.MeridianAuth.requireLogin("/login.html");
      loadResources(client, auth.profile, true);
    });
  }

  document.addEventListener("DOMContentLoaded", main);
})();
