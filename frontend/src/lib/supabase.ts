/**
 * The ONE supabase-js client for the whole app.
 * Used only for the auth session and Realtime subscriptions; all data
 * reads/writes go through the FastAPI backend (see lib/api.ts).
 */
import { createClient } from '@supabase/supabase-js';
import { env } from './env';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true, // keep the session in localStorage so F5 never logs out
    autoRefreshToken: true,
    detectSessionInUrl: false, // we never use redirect-based auth flows
  },
});
