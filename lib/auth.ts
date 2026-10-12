import { useCallback, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import type { Profile } from './dbTypes';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ session: null, user: null, profile: null, loading: isSupabaseConfigured });

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    return data as Profile | null;
  }, []);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const profile = session?.user ? await loadProfile(session.user.id) : null;
      setState({ session, user: session?.user ?? null, profile, loading: false });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const profile = session?.user ? await loadProfile(session.user.id) : null;
      setState({ session, user: session?.user ?? null, profile, loading: false });
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signInWithMagicLink = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Backend not configured');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },
    });
    if (error) throw error;
  }, []);

  /**
   * Google sign-in. Returning to window.location.href keeps any ?task= or ?event=
   * parameter intact, so following a shared link and then signing in lands you
   * back on the same task rather than a blank builder.
   */
  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Backend not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.href,
        // Lets someone pick a different Google account instead of silently
        // reusing whichever one the browser is already signed into.
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const setDisplayName = useCallback(async (displayName: string) => {
    if (!supabase || !state.user) throw new Error('Not signed in');
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName })
      .eq('id', state.user.id);
    if (error) throw error;
    setState(prev => prev.profile ? { ...prev, profile: { ...prev.profile, display_name: displayName } } : prev);
  }, [state.user]);

  return { ...state, signInWithMagicLink, signInWithGoogle, signOut, setDisplayName };
}
