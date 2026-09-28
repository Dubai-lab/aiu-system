// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import type { Me } from '@/lib/types';

afterEach(cleanup);

const student: Me = {
  id: 'u1', role: 'student', full_name: 'Jane Doe', email: 'jane@example.com', reg_number: 'AIU-2026-0001',
  staff_title: null, department: null, level: 100, intake_year: 2026, phone: null, face_enrolled: false,
  must_change_password: true, is_active: true, created_at: '2026-01-01T00:00:00Z', force_password_change: false,
};
const session = { user: { id: 'u1' }, access_token: 't' } as unknown as Session;

function renderAt(path: string, auth: Partial<AuthContextValue>) {
  const value: AuthContextValue = {
    initializing: false, session: null, profile: null, profileLoading: false, profileError: null, signedOutByUser: false,
    refetchProfile: () => {}, signInWithPassword: async () => {}, signInWithFaceToken: async () => {},
    signOut: async () => {}, ...auth,
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>login page</p>} />
          <Route path="/student/profile" element={<ProtectedRoute roles={['student']}><p>student profile</p></ProtectedRoute>} />
          <Route path="/student" element={<ProtectedRoute roles={['student']}><p>student home</p></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute roles={['admin']}><p>admin home</p></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('ProtectedRoute', () => {
  it('shows a loader (never the login page) while the session is being restored', () => {
    renderAt('/student', { initializing: true });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('login page')).toBeNull();
  });

  it('shows a loader while the profile loads', () => {
    renderAt('/student', { session, profileLoading: true });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('redirects to /login when there is no session', () => {
    renderAt('/student', {});
    expect(screen.getByText('login page')).toBeTruthy();
  });

  it('renders the page for the right role', () => {
    renderAt('/student', { session, profile: student });
    expect(screen.getByText('student home')).toBeTruthy();
  });

  it('blocks a student from an admin page', () => {
    renderAt('/admin', { session, profile: student });
    expect(screen.getByText('Not authorised')).toBeTruthy();
    expect(screen.queryByText('admin home')).toBeNull();
  });

  it('forces the profile page when a password change is mandatory', () => {
    renderAt('/student', { session, profile: { ...student, force_password_change: true } });
    expect(screen.getByText('student profile')).toBeTruthy();
  });

  it('shows a retry screen instead of logging out on a network error', async () => {
    const { ApiError } = await import('@/lib/api');
    renderAt('/student', { session, profileError: new ApiError(0, 'network_error', 'Cannot reach the server.') });
    expect(screen.getByText('Cannot reach the server.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});

describe('ProtectedRoute redirect memory', () => {
  function LoginProbe() {
    const loc = useLocation();
    return <p>login from={(loc.state as { from?: string } | null)?.from ?? 'none'}</p>;
  }
  const renderProbe = (signedOutByUser: boolean) =>
    render(
      <AuthContext.Provider value={{
        initializing: false, session: null, profile: null, profileLoading: false, profileError: null, signedOutByUser,
        refetchProfile: () => {}, signInWithPassword: async () => {}, signInWithFaceToken: async () => {}, signOut: async () => {},
      }}>
        <MemoryRouter initialEntries={['/student/courses']}>
          <Routes>
            <Route path="/login" element={<LoginProbe />} />
            <Route path="/student/courses" element={<ProtectedRoute roles={['student']}><p>courses</p></ProtectedRoute>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

  it('remembers the page when the session expired by itself', () => {
    renderProbe(false);
    expect(screen.getByText('login from=/student/courses')).toBeTruthy();
  });

  it('forgets the page after a deliberate logout (next user starts at their dashboard)', () => {
    renderProbe(true);
    expect(screen.getByText('login from=none')).toBeTruthy();
  });
});
