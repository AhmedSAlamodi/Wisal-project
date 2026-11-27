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
const hasValidUrl = isValidSupabaseUrl(supabaseUrl);

if (!hasValidUrl || !supabaseAnonKey) {
  if (!supabaseUrl && !supabaseAnonKey) {
    console.warn(
      '[Wisal Supabase] Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY; falling back to localStorage.'
    );
  } else if (!hasValidUrl) {
    console.warn(
      '[Wisal Supabase] Invalid VITE_SUPABASE_URL; falling back to localStorage.'
    );
  } else {
    console.warn(
      '[Wisal Supabase] Missing VITE_SUPABASE_ANON_KEY; falling back to localStorage.'
    );
  }
}

export const supabase: SupabaseClient | null =
  hasValidUrl && Boolean(supabaseAnonKey)
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
