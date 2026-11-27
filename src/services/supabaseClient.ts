import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function readViteEnv(key: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  try {
    const metaEnv = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env;
    if (metaEnv && typeof metaEnv[key] === 'string') {
      return metaEnv[key]!.trim();
    }
  } catch {
    // تجاهل في البيئات التي لا تدعم import.meta.env
  }

  if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') {
    return process.env[key]!.trim();
  }

  return '';
}

function isValidSupabaseUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const supabaseUrl = readViteEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = readViteEnv('VITE_SUPABASE_ANON_KEY');

export const supabase: SupabaseClient | null =
  isValidSupabaseUrl(supabaseUrl) && Boolean(supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}
