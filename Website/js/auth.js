// Shared auth helpers used by login.html and resources.html.
window.MeridianAuth = (function () {
  async function getSessionUser() {
    var client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) return null;
    var { data } = await client.auth.getSession();
    return data && data.session ? data.session.user : null;
  }

  async function getProfile(userId) {
    var client = window.getSupabaseClient();
    var { data, error } = await client
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) return null;
    return data;
  }

  async function requireLogin(redirectTo) {
    var client = window.getSupabaseClient && window.getSupabaseClient();
    if (!client) {
      return { configured: false, user: null, profile: null };
    }
    var user = await getSessionUser();
    if (!user) {
      window.location.href = redirectTo || "/login.html";
      return { configured: true, user: null, profile: null };
    }
    var profile = await getProfile(user.id);
    return { configured: true, user: user, profile: profile };
  }

  async function login(email, password) {
    var client = window.getSupabaseClient();
    return client.auth.signInWithPassword({ email: email, password: password });
  }

  async function logout() {
    await hardLogout();
    window.location.href = "/login.html";
  }

  // Sign out of EVERYTHING and clear the local token cache.
  //
  // signOut() alone leaves the supabase auth token in localStorage in some
  // browsers, which is what left the client login link "stuck" — the page saw a
  // session that the server had already invalidated and bounced past the form.
  // scope:"global" also kills the refresh token server-side, so other tabs and
  // devices are logged out too, which is what "logged out of everything" means.
  async function hardLogout() {
    var client = window.getSupabaseClient && window.getSupabaseClient();
    if (client) {
      try { await client.auth.signOut({ scope: "global" }); }
      catch (e) { try { await client.auth.signOut(); } catch (e2) { /* offline */ } }
    }
    try {
      Object.keys(window.localStorage)
        .filter(function (k) { return /^sb-.*-auth-token/.test(k) || k.indexOf("supabase.auth") === 0; })
        .forEach(function (k) { window.localStorage.removeItem(k); });
      window.sessionStorage.clear();
    } catch (e) { /* storage may be blocked */ }
  }

  async function isAdmin() {
    var u = await getSessionUser();
    if (!u) return false;
    var p = await getProfile(u.id);
    return !!(p && p.role === "admin");
  }

  return { getSessionUser: getSessionUser, getProfile: getProfile, requireLogin: requireLogin,
           login: login, logout: logout, hardLogout: hardLogout, isAdmin: isAdmin };
})();
