import { createClient } from '@supabase/supabase-js';

// Supabase's own dashboard shows the REST endpoint (`.../rest/v1/`) in several places
// people copy from — createClient wants just the bare project URL and appends the
// per-service paths itself, so strip a copy-pasted /rest/v1/ (or trailing slash) here.
const url = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Sharing/voting/events/scoring features degrade gracefully when these are unset
// (see lib/auth.ts / callers checking isSupabaseConfigured) so the core task
// builder keeps working with zero backend setup.
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey)
  : null;
