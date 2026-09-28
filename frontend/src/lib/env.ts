/** Public frontend configuration. Fails fast with a clear message if a value is missing. */

function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy frontend/.env.example to frontend/.env and fill it in.`);
  }
  return value;
}

export const env = {
  supabaseUrl: required('VITE_SUPABASE_URL'),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY'),
  apiBaseUrl: required('VITE_API_BASE_URL').replace(/\/+$/, ''),
};
