import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase browser client is initialized only when Vite build/dev env vars are provided.
const supabaseUrl = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || '').trim();
const supabaseAnonKey = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '').trim();

export const isSupabaseClientConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
