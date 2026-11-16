import type { EdgeEnv } from '../../src/server/edgeStore.ts';
import type { PublicConfigStatus, ServiceConfigStatus } from '../../src/types/restaurant.ts';

export function handlePublicConfigStatus(env: EdgeEnv): PublicConfigStatus {
  return {
    ok: true,
    version: String((env as Record<string, unknown>).APP_VERSION || '2.0.0'),
  };
}

export function getAdminServiceConfigStatus(
  env: EdgeEnv,
  supabaseBackendActive: boolean
): ServiceConfigStatus {
  const geminiConfigured = Boolean(
    env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const supabaseAnon = env.VITE_SUPABASE_ANON_KEY;
  const supabaseConfigured = Boolean(supabaseUrl && supabaseAnon);

  return {
    geminiConfigured,
    supabaseConfigured,
    storageMode: supabaseBackendActive ? 'supabase' : 'local',
    authMode: supabaseConfigured ? 'supabase' : 'local',
  };
}
