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
    var client = window.getSupabaseClient();
    await client.auth.signOut();
    window.location.href = "/login.html";
  }

  return { getSessionUser: getSessionUser, getProfile: getProfile, requireLogin: requireLogin, login: login, logout: logout };
})();
