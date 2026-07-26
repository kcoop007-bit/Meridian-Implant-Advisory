// Pure access-decision logic — mirrors the SQL function public.has_access()
// in supabase-schema-v2.sql so the admin UI can preview what a user can see,
// and so the revocation rules are unit-testable without a database.
//
// Model: DEFAULT ALLOW, explicit DENY.
//   - admins always have access
//   - an inactive account (is_active === false) has no access
//   - a DENY entitlement (granted === false, revoked_at set) for the scope
//     — or a global 'all' DENY — blocks that scope
//   - otherwise: allowed
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; // node
  root.MeridianAccess = api;                                             // browser
})(typeof self !== "undefined" ? self : this, function () {
  function hasAccess(profile, entitlements, scope) {
    if (!profile) return false;
    if (profile.role === "admin") return true;
    if (profile.is_active === false) return false;
    var denied = (entitlements || []).some(function (e) {
      return (
        e.granted === false &&
        e.revoked_at != null &&
        (e.scope === scope || e.scope === "all")
      );
    });
    return !denied;
  }
  return { hasAccess: hasAccess };
});
