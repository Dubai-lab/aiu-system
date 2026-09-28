/**
 * Route table. Public routes, then one guarded layout per role whose child
 * routes are generated from shared/pages.json.
 */
import type { ComponentType } from 'react';
import { Route, Routes } from 'react-router-dom';
import { GuestRoute, ProtectedRoute, RootRedirect } from '@/auth/ProtectedRoute';
import AdminLayout from '@/layouts/AdminLayout';
import StudentLayout from '@/layouts/StudentLayout';
import TeacherLayout from '@/layouts/TeacherLayout';
import { pagesForRole } from '@/lib/pages';
import type { Role } from '@/lib/types';
import { PAGE_COMPONENTS } from '@/pageComponents';
import LoginPage from '@/pages/auth/LoginPage';
import NotAuthorisedPage from '@/pages/shared/NotAuthorisedPage';
import NotFoundPage from '@/pages/shared/NotFoundPage';

const LAYOUTS: Record<Role, ComponentType> = {
  admin: AdminLayout,
  teacher: TeacherLayout,
  student: StudentLayout,
};

function roleRoutes(role: Role) {
  const Layout = LAYOUTS[role];
  return (
    <Route
      key={role}
      element={
        <ProtectedRoute roles={[role]}>
          <Layout />
        </ProtectedRoute>
      }
    >
      {pagesForRole(role).map((page) => {
        const Page = PAGE_COMPONENTS[page.key];
        return Page ? <Route key={page.key} path={page.path} element={<Page />} /> : null;
      })}
    </Route>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route
        path="/login"
        element={
          <GuestRoute>
            <LoginPage />
          </GuestRoute>
        }
      />
      <Route path="/not-authorised" element={<NotAuthorisedPage />} />
      {(['admin', 'teacher', 'student'] as Role[]).map(roleRoutes)}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
