/**
 * Supabase project used for accounts and cloud saves. Both values come from
 * the project's Settings → API page. The anon key is meant to be public:
 * row-level security (see supabase/schema.sql) keeps each save private.
 * Leave them empty to run without accounts.
 */
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";
