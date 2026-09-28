/**
 * Shared shell for the three role layouts: collapsible sidebar (built from
 * shared/pages.json), top bar with name / role badge / logout, the
 * default-password banner, and an error boundary around the page content.
 */
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarCheck,
  Building2,
  ClipboardList,
  FileText,
  BookUser,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  ScrollText,
  ShieldCheck,
  UserCircle,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Skeleton } from '@/components/DataStates';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AssistantPanel } from '@/features/assistant/AssistantPanel';
import { AssistantProvider, useAssistant } from '@/features/assistant/AssistantProvider';
import { navPagesForRole, profilePathFor } from '@/lib/pages';
import type { Role } from '@/lib/types';

/** pages.json "icon" name -> lucide icon. */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  profile: UserCircle,
  students: GraduationCap,
  teachers: BookUser,
  admins: ShieldCheck,
  departments: Building2,
  courses: BookOpen,
  enrollments: ClipboardList,
  attendance: CalendarCheck,
  reports: BarChart3,
  fees: Wallet,
  invoices: FileText,
  audit: ScrollText,
  email: Mail,
};

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', teacher: 'Teacher', student: 'Student' };
const ROLE_BADGE: Record<Role, string> = {
  admin: 'bg-purple-100 text-purple-800',
  teacher: 'bg-emerald-100 text-emerald-800',
  student: 'bg-sky-100 text-sky-800',
};

/** Page column. On large screens it makes room for the open assistant panel instead of
 *  being covered by it (so e.g. the class code on the live attendance page stays visible). */
function ContentColumn({ children }: { children: ReactNode }) {
  const { open } = useAssistant();
  return <div className={`flex min-w-0 flex-1 flex-col transition-[padding] ${open ? 'lg:pr-[420px]' : ''}`}>{children}</div>;
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-3 px-5 py-5">
      <span className="flex size-10 items-center justify-center rounded-lg bg-accent-400 text-sm font-bold text-brand-900">
        AIU
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-white">AIU Management</span>
        <span className="block text-xs text-brand-100">Voice &amp; Face ID System</span>
      </span>
    </Link>
  );
}

export function AppShell({ role }: { role: Role }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const nav = navPagesForRole(role);

  // Close the mobile menu after navigating.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    navigate('/login', { replace: true });
  };

  const profilePath = profilePathFor(role);
  const showPasswordBanner = profile?.must_change_password && location.pathname !== profilePath;

  return (
    <AssistantProvider>
    <div className="flex min-h-full">
      {/* Mobile overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-brand-700 transition-transform print:hidden lg:static lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between">
          <Brand />
          <button
            type="button"
            className="mr-3 rounded-md p-2 text-brand-100 hover:bg-brand-800 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {nav.map((page) => {
            const Icon = ICONS[page.icon ?? ''] ?? LayoutDashboard;
            return (
              <NavLink
                key={page.key}
                to={page.path}
                end={page.path === `/${role}`} // the dashboard is only active on its own URL
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-white/15 text-white' : 'text-brand-100 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {page.title}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <ContentColumn>
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 print:hidden sm:px-6">
          <button
            type="button"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-900">{profile?.full_name}</p>
              <p className="text-xs text-slate-500">{profile?.reg_number ?? profile?.staff_title ?? profile?.email}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_BADGE[role]}`}>{ROLE_LABEL[role]}</span>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
            >
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </header>

        {showPasswordBanner && (
          <div role="status" className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 print:hidden sm:px-6">
            <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden />
            <p className="flex-1 text-sm text-amber-900">You are still using your default password - change it now.</p>
            <Link
              to={profilePath}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
            >
              Change password
            </Link>
          </div>
        )}

        <main className="flex-1 p-4 print:p-0 sm:p-6 lg:p-8">
          {/* Keyed by path so an error on one page clears when the user navigates away. */}
          <ErrorBoundary key={location.pathname} label="this page">
            {/* Pages are lazy-loaded chunks: show a skeleton while one downloads. */}
            <Suspense fallback={<div className="mx-auto max-w-6xl space-y-4" role="status" aria-label="Loading page">
              <Skeleton className="h-8 w-64" /><Skeleton className="h-48 w-full rounded-xl" /></div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </ContentColumn>
    </div>
    {/* The voice assistant is available on every page of every role (spec 13.2). */}
    <AssistantPanel />
    </AssistantProvider>
  );
}
