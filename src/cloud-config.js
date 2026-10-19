/**
 * Supabase project used for accounts and cloud saves. Both values come from
 * the project's Settings → API page. The anon (publishable) key is meant to be public:
 * row-level security (see supabase/schema.sql) keeps each save private.
 * Leave them empty to run without accounts.
 */
export const SUPABASE_URL = "https://rweycczgxrrxlwpaiwec.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_s6hez1pv9G7hN_abse5EhA_exxrOVDj";
