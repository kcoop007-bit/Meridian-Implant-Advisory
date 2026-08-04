// Admin "view as" mode + the bar that lets you switch back.
//
// Two problems this solves:
//   1. Picking a portal on portal.html was a one-way door — there was no way
//      back without clearing the session.
//   2. An admin browsing the client portal still saw admin controls (upload
//      panels and the like), so it wasn't actually the client's view. The whole
//      point of "see what clients see" is that you see what they see.
//
// Mode lives in sessionStorage, so it lasts the browsing session but a fresh
// login starts at the chooser again. It is a VIEW preference only — it never
// grants anything. Every real permission still comes from the profile role and
// from RLS, so a client cannot fake their way into admin by setting this.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MeridianPortalMode = api;
})(typeof self !== "undefined" ? self : this, function () {
  var KEY = "meridian.portalMode";
  var AS_KEY = "meridian.viewAsType";   // 'gp' | 'specialist' when previewing

  function get() {
    try { return window.sessionStorage.getItem(KEY) || "admin"; }
    catch (e) { return "admin"; }
  }

  function set(mode) {
    try { window.sessionStorage.setItem(KEY, mode === "client" ? "client" : "admin"); }
    catch (e) { /* storage blocked — fall back to admin */ }
  }

  // True when an admin has chosen to look at the client portal. Used to suppress
  // admin-only UI so the view is honest.
  function viewingAsClient(profile) {
    return !!(profile && profile.role === "admin" && get() === "client");
  }

  // The effective "is this person an admin, for UI purposes" test. Real
  // authorisation must not use this — use profile.role directly.
  function actsAsAdmin(profile) {
    return !!(profile && profile.role === "admin") && get() !== "client";
  }

  // A slim bar pinned to the top, shown to admins only, so switching back is
  // always one click away from any page.
  function mountBar(profile) {
    if (!profile || profile.role !== "admin") return;
    if (document.getElementById("mim-mode-bar")) return;

    var asClient = get() === "client";
    var bar = document.createElement("div");
    bar.id = "mim-mode-bar";
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:sticky;top:0;z-index:9999;display:flex;gap:14px;align-items:center;" +
      "justify-content:center;padding:7px 14px;font-family:Arial,Helvetica,sans-serif;" +
      "font-size:13px;line-height:1.3;" +
      (asClient ? "background:#B8863B;color:#fff;" : "background:#151B23;color:#fff;");

    var label = document.createElement("span");
    label.textContent = asClient
      ? "Viewing the client portal as an admin"
      : "Admin portal";

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = asClient ? "Switch to Admin portal" : "View client portal";
    toggle.style.cssText =
      "background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.45);" +
      "color:#fff;border-radius:4px;padding:3px 11px;font-size:12.5px;cursor:pointer;";
    toggle.addEventListener("click", function () {
      set(asClient ? "admin" : "client");
      window.location.href = asClient ? "/admin.html" : "/resources.html";
    });

    var chooser = document.createElement("a");
    chooser.href = "/portal.html";
    chooser.textContent = "Portal chooser";
    chooser.style.cssText = "color:rgba(255,255,255,.85);font-size:12.5px;text-decoration:underline;";

    bar.appendChild(label);
    bar.appendChild(toggle);

    if (asClient) {
      var sel = document.createElement("select");
      sel.style.cssText =
        "background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.45);" +
        "color:#fff;border-radius:4px;padding:3px 8px;font-size:12.5px;";
      [["gp", "as General practice"], ["specialist", "as Specialist"]].forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o[0]; opt.textContent = o[1];
        opt.style.color = "#151B23";
        sel.appendChild(opt);
      });
      sel.value = viewAsType() || "gp";
      sel.addEventListener("change", function () {
        setViewAsType(sel.value);
        window.location.reload();
      });
      bar.appendChild(sel);
    }

    bar.appendChild(chooser);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // Which client library an admin is previewing. Null = the admin's own view.
  function viewAsType() {
    try { return window.sessionStorage.getItem(AS_KEY) || null; } catch (e) { return null; }
  }
  function setViewAsType(t) {
    try {
      if (t) window.sessionStorage.setItem(AS_KEY, t);
      else window.sessionStorage.removeItem(AS_KEY);
    } catch (e) { /* storage blocked */ }
  }

  // The client_type the resource list should filter by. For a real client this
  // is simply their own; for an admin previewing, it is the chosen one.
  function effectiveClientType(profile) {
    if (profile && profile.role === "admin" && get() === "client") {
      return viewAsType() || "gp";
    }
    return profile ? profile.client_type : null;
  }

  return { get: get, set: set, viewingAsClient: viewingAsClient,
           viewAsType: viewAsType, setViewAsType: setViewAsType,
           effectiveClientType: effectiveClientType,
           actsAsAdmin: actsAsAdmin, mountBar: mountBar };
});
