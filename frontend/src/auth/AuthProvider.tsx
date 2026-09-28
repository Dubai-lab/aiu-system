/**
 * Session + profile state for the whole app (spec 8.4 and 16.2).
 *
 * - On load: getSession() restores the stored session; a full-screen loader is
 *   shown until this first check finishes, so a refresh never flashes the login page.
 * - onAuthStateChange keeps the session in sync (sign in, sign out, token refresh,
 *   other tabs). TOKEN_REFRESHED only swaps the token: the user id stays the same,
 *   so nothing re-renders into a loading state and nobody is redirected.
 * - The session is re-checked when the window regains focus or becomes visible.
 * - The profile (role!) comes from GET /me, cached by TanStack Query per user id.
 */
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { LoginResponse, Me } from '@/lib/types';

export interface AuthContextValue {
  /** True until the first getSession() has finished. */
  initializing: boolean;
  session: Session | null;
  profile: Me | null;
  profileLoading: boolean;
  /** Non-auth failure loading the profile (network, server) - shown with a retry button. */
  profileError: ApiError | null;
  refetchProfile: () => void;
  /** True after the user logged out on purpose, so the login page does not send the
   *  NEXT person back to the previous user's page. Reset on the next sign-in. */
  signedOutByUser: boolean;
  signInWithPassword: (identifier: string, password: string) => Promise<void>;
  /** Exchange the single-use token from a successful face login for a session. */
  signInWithFaceToken: (tokenHash: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const meQueryKey = (userId: string | undefined) => ['me', userId] as const;

/** Errors that mean "this login is no longer valid" -> sign out instead of retrying. */
function isAuthFailure(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

/** Last-resort cleanup if the sign-out request cannot reach Supabase. */
function clearStoredSupabaseSession() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable - nothing to clear */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [signedOutByUser, setSignedOutByUser] = useState(false);

  // Only replace the session object when the token actually changed.
  const applySession = useCallback((next: Session | null) => {
    setSession((prev) => (prev?.access_token === next?.access_token ? prev : next));
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) applySession(data.session);
      })
      .catch((err) => console.error('getSession failed', err))
      .finally(() => {
        if (active) setInitializing(false);
      });

    // NOTE: never await other supabase calls inside this callback (it can deadlock
    // supabase-js); it only stores the new session.
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      applySession(next);
      if (event === 'SIGNED_OUT') queryClient.removeQueries({ queryKey: ['me'] });
    });

    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      supabase.auth
        .getSession()
        .then(({ data }) => active && applySession(data.session))
        .catch(() => {
          /* transient network error: keep the current session */
        });
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [applySession, queryClient]);

  const userId = session?.user.id;
  const profileQuery = useQuery({
    queryKey: meQueryKey(userId),
    queryFn: () => api.get<Me>('/me'),
    enabled: Boolean(userId),
  });

  const signOut = useCallback(async () => {
    setSignedOutByUser(true);
    queryClient.clear();
    try {
      // Fire-and-forget with a time limit: a slow network must never trap the user.
      const result = await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise<{ error: Error }>((resolve) =>
          setTimeout(() => resolve({ error: new Error('sign-out timeout') }), 3000),
        ),
      ]);
      if (result.error) clearStoredSupabaseSession();
    } catch {
      clearStoredSupabaseSession();
    }
    setSession(null);
  }, [queryClient]);

  // A 401/403 from /me (deactivated account, deleted profile, revoked token) ends the session.
  const profileFailure = profileQuery.error;
  useEffect(() => {
    if (isAuthFailure(profileFailure)) {
      toast.error(profileFailure.message);
      void signOut();
    }
  }, [profileFailure, signOut]);

  const signInWithPassword = useCallback(async (identifier: string, password: string) => {
    const result = await api.post<LoginResponse>('/auth/login', { identifier, password });
    setSignedOutByUser(false);
    const { error } = await supabase.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
    });
    if (error) throw new ApiError(0, 'session_error', 'Could not start your session. Please try again.');
    // onAuthStateChange(SIGNED_IN) now stores the session and /me loads the profile.
  }, []);

  const signInWithFaceToken = useCallback(async (tokenHash: string) => {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    setSignedOutByUser(false);
    if (error) throw new ApiError(0, 'session_error', 'Could not start your session. Please try again.');
    // onAuthStateChange(SIGNED_IN) stores the session - identical to a password login.
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      initializing,
      session,
      profile: profileQuery.data ?? null,
      profileLoading: Boolean(userId) && profileQuery.isPending,
      profileError:
        profileQuery.error instanceof ApiError && !isAuthFailure(profileQuery.error) ? profileQuery.error : null,
      refetchProfile: () => void profileQuery.refetch(),
      signedOutByUser,
      signInWithPassword,
      signInWithFaceToken,
      signOut,
    }),
    [initializing, session, userId, profileQuery, signedOutByUser, signInWithPassword, signInWithFaceToken, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
