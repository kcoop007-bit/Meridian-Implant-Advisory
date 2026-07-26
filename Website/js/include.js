// Injects shared header/footer partials and wires up common page behavior.
(function () {
  function markCurrentNav() {
    var path = window.location.pathname.split("/").pop() || "index.html";
    var map = {
      "index.html": "home",
      "general-dentists.html": "gp",
      "specialists.html": "specialists",
      "events.html": "events",
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
      }
    });
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
