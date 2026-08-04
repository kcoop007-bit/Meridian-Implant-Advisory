// Injects shared header/footer partials and wires up common page behavior.
(function () {
  function markCurrentNav() {
    var path = window.location.pathname.split("/").pop() || "index.html";
    var map = {
      "index.html": "home",
      "general-dentists.html": "gp",
      "specialists.html": "specialists",
      "become-client.html": "become",
      "login.html": "login",
      "resources.html": "login"
    };
    var key = map[path];
    if (!key) return;
    document.querySelectorAll('[data-nav="' + key + '"]').forEach(function (el) {
      el.classList.add("current");
    });
  }

  function wireAuthAwareNav() {
    var link = document.querySelector('[data-nav="login"]');
    if (!link) return;
    var client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) return; // Supabase not loaded/configured on this page yet
    client.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (session) {
        link.textContent = "Resources";
        link.setAttribute("href", "/resources.html");
        link.setAttribute("data-nav", "resources");
        addLogoutLink(link);
      }
    });
  }


  // "Client Login" becomes "Resources" once signed in, which left no way out of
  // the session from the top menu. This adds a Log Out beside it.
  //
  // It calls MeridianAuth.hardLogout() where available — signOut({scope:"global"})
  // plus a purge of the cached token — rather than a plain signOut, because a
  // leftover token in localStorage is exactly what made the login link look stuck.
  function addLogoutLink(afterEl) {
    if (document.querySelector('[data-nav="logout"]')) return;
    var a = document.createElement("a");
    a.href = "/login.html?signout=1";
    a.textContent = "Log Out";
    a.setAttribute("data-nav", "logout");
    a.addEventListener("click", function (e) {
      e.preventDefault();
      a.textContent = "Signing out…";
      var done = function () { window.location.href = "/login.html"; };
      if (window.MeridianAuth && window.MeridianAuth.hardLogout) {
        window.MeridianAuth.hardLogout().then(done, done);
      } else {
        var c = window.getSupabaseClient && window.getSupabaseClient();
        if (c) { c.auth.signOut().then(done, done); } else { done(); }
      }
    });
    afterEl.parentNode.insertBefore(a, afterEl.nextSibling);
  }

  function wireNavToggle() {
    var toggle = document.getElementById("navToggle");
    var nav = document.getElementById("primaryNav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      nav.classList.toggle("open");
    });
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { nav.classList.remove("open"); });
    });
  }

  function loadPartial(selector, url, done) {
    var target = document.querySelector(selector);
    if (!target) { if (done) done(); return; }
    fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        target.innerHTML = html;
        if (done) done();
      })
      .catch(function () {
        target.innerHTML = "";
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadPartial("#header-slot", "/partials/header.html", function () {
      markCurrentNav();
      wireNavToggle();
      wireAuthAwareNav();
    });
    loadPartial("#account-nav-slot", "/partials/account-nav.html", function () {
      var path = window.location.pathname.split("/").pop() || "";
      var el = document.querySelector('#account-nav-slot [data-acct="' + path + '"]');
      if (el) el.classList.add("current");
    });
    loadPartial("#footer-slot", "/partials/footer.html", function () {
      var y = document.getElementById("year");
      if (y) y.textContent = new Date().getFullYear();
    });
  });
})();
