// ---------------------------------------------------------------
// Supabase project config.
// Replace these two values once you've created your free Supabase
// project (Project Settings -> API -> Project URL / anon public key).
// The "anon" key is safe to expose in client-side code by design —
// it only allows what your Row Level Security policies permit.
// ---------------------------------------------------------------
window.MERIDIAN_SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
window.MERIDIAN_SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

window.getSupabaseClient = function () {
  if (
    !window.supabase ||
    window.MERIDIAN_SUPABASE_URL.indexOf("YOUR-PROJECT-REF") !== -1
  ) {
    return null; // not configured yet
  }
  if (!window._meridianSupabaseClient) {
    window._meridianSupabaseClient = window.supabase.createClient(
      window.MERIDIAN_SUPABASE_URL,
      window.MERIDIAN_SUPABASE_ANON_KEY
    );
  }
  return window._meridianSupabaseClient;
};
