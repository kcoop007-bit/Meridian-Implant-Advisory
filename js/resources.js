// Powers resources.html: auth-gated resource library with a real
// drag-and-drop upload panel for admins, and a browse/download view
// for everyone else.
(function () {
  var CATEGORY_LABELS = { general: "General", gp: "For General Dentists", specialist: "For Specialists" };

  async function main() {
    var client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) {
      show("#not-configured");
      hide("#loading");
      return;
    }

    var auth = await window.MeridianAuth.requireLogin("/login.html");
    if (!auth.user) return; // requireLogin already redirected

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
    }

    await loadResources(client, auth.profile, isAdmin);
  }

  function show(sel) { var el = document.querySelector(sel); if (el) el.style.display = ""; }
  function hide(sel) { var el = document.querySelector(sel); if (el) el.style.display = "none"; }

  async function loadResources(client, profile, isAdmin) {
    var { data, error } = await client
      .from("resources")
      .select("*")
      .order("uploaded_at", { ascending: false });

    var list = document.getElementById("resource-list");
    list.innerHTML = "";

    if (error) {
      list.innerHTML = '<p style="color:#B4423C;">Could not load resources: ' + error.message + "</p>";
      return;
    }

    var visible = data.filter(function (r) {
      if (isAdmin) return true;
      if (r.category === "general") return true;
      return profile && r.category === profile.client_type;
    });

    if (visible.length === 0) {
      list.innerHTML = '<p style="color:var(--text-faint);">No resources here yet — check back soon.</p>';
      return;
    }

    var groups = {};
    visible.forEach(function (r) {
      groups[r.category] = groups[r.category] || [];
      groups[r.category].push(r);
    });

    Object.keys(CATEGORY_LABELS).forEach(function (cat) {
      if (!groups[cat]) return;
      var section = document.createElement("div");
      section.style.marginBottom = "36px";
      var h = document.createElement("h4");
      h.textContent = CATEGORY_LABELS[cat];
      section.appendChild(h);

      groups[cat].forEach(function (r) {
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
          var client2 = window.getSupabaseClient();
          var { data: signed, error: sErr } = await client2.storage
            .from("resources")
            .createSignedUrl(r.file_path, 60);
          if (sErr) { alert("Couldn't generate a download link: " + sErr.message); return; }
          window.open(signed.signedUrl, "_blank");
        });
        right.appendChild(dl);

        if (isAdmin) {
          var del = document.createElement("button");
          del.className = "btn btn-outline-dark btn-sm";
          del.textContent = "Remove";
          del.style.color = "#B4423C";
          del.addEventListener("click", async function () {
            if (!confirm('Remove "' + r.title + '"? This can\'t be undone.')) return;
            var client3 = window.getSupabaseClient();
            await client3.storage.from("resources").remove([r.file_path]);
            await client3.from("resources").delete().eq("id", r.id);
            loadResources(client3, profile, isAdmin);
          });
          right.appendChild(del);
        }

        row.appendChild(right);
        section.appendChild(row);
      });

      list.appendChild(section);
    });
  }

  function wireUpload(client) {
    var zone = document.getElementById("drop-zone");
    var input = document.getElementById("file-input");
    var titleInput = document.getElementById("up-title");
    var descInput = document.getElementById("up-desc");
    var categorySelect = document.getElementById("up-category");
    var status = document.getElementById("upload-status");
    var pendingFile = null;

    function setFile(file) {
      pendingFile = file;
      zone.querySelector(".dz-text").textContent = file ? file.name : "Drag a file here, or click to browse";
      if (file && !titleInput.value) {
        titleInput.value = file.name.replace(/\.[a-zA-Z0-9]+$/, "");
      }
    }

    zone.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () { setFile(input.files[0] || null); });

    ["dragenter", "dragover"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.add("dz-active");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.remove("dz-active");
      });
    });
    zone.addEventListener("drop", function (e) {
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) setFile(file);
    });

    document.getElementById("upload-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!pendingFile) { status.textContent = "Choose a file first."; status.style.color = "#B4423C"; return; }
      status.textContent = "Uploading...";
      status.style.color = "var(--text-faint)";

      var path = Date.now() + "-" + pendingFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      var { error: upErr } = await client.storage.from("resources").upload(path, pendingFile);
      if (upErr) { status.textContent = "Upload failed: " + upErr.message; status.style.color = "#B4423C"; return; }

      var { error: rowErr } = await client.from("resources").insert([{
        title: titleInput.value.trim() || pendingFile.name,
        description: descInput.value.trim(),
        file_path: path,
        category: categorySelect.value
      }]);
      if (rowErr) { status.textContent = "Saved file, but failed to record it: " + rowErr.message; status.style.color = "#B4423C"; return; }

      status.textContent = "Uploaded.";
      status.style.color = "#2E7D4F";
      document.getElementById("upload-form").reset();
      setFile(null);
      var auth = await window.MeridianAuth.requireLogin("/login.html");
      loadResources(client, auth.profile, true);
    });
  }

  document.addEventListener("DOMContentLoaded", main);
})();
