// Backend selection.
//   Empty values  -> the site talks to the Node server it is served from (/api).
//   Supabase URL + publishable (anon) key -> static hosting (GitHub Pages) with
//   the Supabase database. The publishable key is meant to be public; the
//   database only lets it call the api_* functions in supabase/schema.sql.
export const CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
