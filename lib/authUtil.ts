import { supabase } from './supabase';

export async function requireUserId(): Promise<string> {
  if (!supabase) throw new Error('Backend not configured');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  return user.id;
}
