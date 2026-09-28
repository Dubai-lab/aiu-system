/**
 * Route guards. The auth check happens ONCE here (wrapping each role layout),
 * never inside individual pages.
 *
 *  ProtectedRoute: must be logged in AND have one of `roles`.
 *  GuestRoute:     for /login - sends an already logged-in user to their dashboard.
 *
 * Neither guard ever redirects while the session or profile is still loading.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { FullScreenError, FullScreenLoader } from '@/components/FullScreenStatus';
import { homePathFor, profilePathFor } from '@/lib/pages';
import type { Role } from '@/lib/types';
import NotAuthorisedPage from '@/pages/shared/NotAuthorisedPage';
import { useAuth } from './useAuth';

export function ProtectedRoute({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { initializing, session, profile, profileLoading, profileError, refetchProfile, signOut, signedOutByUser } = useAuth();
  const location = useLocation();

  if (initializing) return <FullScreenLoader />;
  // Remember the page only when the session ended by itself (e.g. expired), never after "Log out".
  if (!session) return <Navigate to="/login" replace state={signedOutByUser ? undefined : { from: location.pathname }} />;
  if (profileError) return <FullScreenError message={profileError.message} onRetry={refetchProfile} onSignOut={signOut} />;
  if (profileLoading || !profile) return <FullScreenLoader />;
  if (!roles.includes(profile.role)) return <NotAuthorisedPage />;

  // Optional policy: must change the default password before using the system.
  const profilePath = profilePathFor(profile.role);
  if (profile.force_password_change && location.pathname !== profilePath) {
    return <Navigate to={profilePath} replace />;
  }
  return <>{children}</>;
}

export function GuestRoute({ children }: { children: ReactNode }) {
  const { initializing, session, profile, profileError, refetchProfile, signOut } = useAuth();
  const location = useLocation();

  if (initializing) return <FullScreenLoader />;
  if (!session) return <>{children}</>;
  if (profileError) return <FullScreenError message={profileError.message} onRetry={refetchProfile} onSignOut={signOut} />;
  if (!profile) return <FullScreenLoader label="Signing you in…" />;

  // Return to the page the user originally asked for, if it belongs to their role.
  const from = (location.state as { from?: string } | null)?.from;
  const home = homePathFor(profile.role);
  const target = from && from.startsWith(home) ? from : home;
  return <Navigate to={target} replace />;
}

/** "/" -> the user's dashboard, or the login page. */
export function RootRedirect() {
  const { initializing, session, profile, profileError, refetchProfile, signOut } = useAuth();
  if (initializing) return <FullScreenLoader />;
  if (!session) return <Navigate to="/login" replace />;
  if (profileError) return <FullScreenError message={profileError.message} onRetry={refetchProfile} onSignOut={signOut} />;
  if (!profile) return <FullScreenLoader />;
  return <Navigate to={homePathFor(profile.role)} replace />;
}
