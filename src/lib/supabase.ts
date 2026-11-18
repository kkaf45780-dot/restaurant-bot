import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase project public configuration. Publishable keys are safe in client code.
const DEFAULT_SUPABASE_URL = 'https://xzrhqkaippwoqakjnxaj.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tDNRf_-iCZvDtmYypg9TdQ_f_3OgLtM';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseClientConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
