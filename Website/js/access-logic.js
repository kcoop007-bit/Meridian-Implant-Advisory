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
  // Tiers permitted into the client portal resource library. Bronze is a
  // book-and-materials tier: it does NOT include portal resources. Kept here,
  // beside hasAccess, so the rule is unit-testable and has exactly one home —
  // but note the UI check is a courtesy. The binding check is the RLS policy in
  // supabase-schema-v6.sql; never rely on this alone.
  var PORTAL_TIERS = ["silver", "gold"];

  function canAccessPortal(profile) {
    if (!profile) return false;
    if (profile.role === "admin") return true;
    if (profile.is_active === false) return false;
    return PORTAL_TIERS.indexOf(profile.membership_tier) !== -1;
  }

  // Baselines are hard-gated: no KPI tracker until they exist, because a tracker
  // with invented or empty baselines produces percentages that are worse than no
  // number at all. Admins bypass so they can inspect a client's view.
  function needsBaselines(profile) {
    if (!profile) return false;
    if (profile.role === "admin") return false;
    return !profile.baselines_completed_at;
  }

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
  return { hasAccess: hasAccess, canAccessPortal: canAccessPortal,
           needsBaselines: needsBaselines, PORTAL_TIERS: PORTAL_TIERS };
});
