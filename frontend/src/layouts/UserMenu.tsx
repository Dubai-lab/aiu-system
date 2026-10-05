/** Account menu in the top bar: avatar + name, opening a dropdown with the user's
 *  details, a link to their profile and Log out. Closes on outside click, Escape
 *  and navigation. */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, UserCircle } from 'lucide-react';
import type { Role } from '@/lib/types';

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', teacher: 'Teacher', student: 'Student' };
const ROLE_BADGE: Record<Role, string> = {
  admin: 'bg-purple-100 text-purple-800',
  teacher: 'bg-emerald-100 text-emerald-800',
  student: 'bg-sky-100 text-sky-800',
};

/** "Dr. Musa Kamara" -> "MK"; "System Administrator" -> "SA". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => !/^(dr|mr|mrs|ms|miss|prof|rev)\.?$/i.test(w));
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

interface Props {
  role: Role;
  fullName: string;
  /** Registration number (students) or staff title. */
  subtitle?: string | null;
  email?: string | null;
  profilePath: string;
  signingOut: boolean;
  onSignOut: () => void;
}

export function UserMenu({ role, fullName, subtitle, email, profilePath, signingOut, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const avatar = (size: string) => (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-brand-700 font-semibold text-white`} aria-hidden>
      {initials(fullName)}
    </span>
  );

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${fullName}`}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {avatar('size-9 text-sm')}
        <span className="hidden max-w-40 truncate text-sm font-medium text-slate-900 sm:block">{fullName}</span>
        <ChevronDown className={`size-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-white py-2 shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center gap-3 px-4 py-3">
            {avatar('size-11 text-base')}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{fullName}</p>
              {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
              {email && <p className="truncate text-xs text-slate-500">{email}</p>}
              <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_BADGE[role]}`}>{ROLE_LABEL[role]}</span>
            </div>
          </div>
          <div className="my-1 border-t border-slate-100" />
          <Link to={profilePath} role="menuitem" onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
            <UserCircle className="size-4 text-slate-500" aria-hidden /> My profile
          </Link>
          <button type="button" role="menuitem" onClick={onSignOut} disabled={signingOut}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-60">
            <LogOut className="size-4" aria-hidden /> {signingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  );
}
