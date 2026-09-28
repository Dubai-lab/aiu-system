/** Dashboard building blocks: data hook, stat tile, attendance meter, section card. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ------------------------------------------------------------------ data
export interface AdminDashboardData {
  students: number;
  teachers: number;
  admins: number;
  courses: number;
  departments: number;
  users_without_face: number;
  attendance_sessions_today: number;
  attendance_rate_today_percent: number | null;
  unpaid_invoices: number;
  unpaid_total_usd: number;
  paid_invoices: number;
  paid_total_usd: number;
  failed_emails: number;
  attendance_threshold: number;
  recent_registrations: DashPerson[];
  users_without_face_list: DashPerson[];
  failed_email_list: { id: string; to_email: string; template: string; error: string | null; created_at: string; related_user_id: string | null }[];
}

export interface DashPerson {
  id: string;
  full_name: string;
  role: 'admin' | 'teacher' | 'student';
  email: string;
  reg_number: string | null;
  created_at: string;
  face_enrolled: boolean;
}

export interface TeacherDashboardData {
  courses: { id: string; code: string; title: string; students: number }[];
  open_sessions: { id: string; course: string; course_title: string; title: string; present: number; enrolled: number; closes_at: string; minutes_left: number }[];
  recent_sessions: { id: string; course: string; title: string; date: string; present: number; enrolled: number; rate_percent: number | null }[];
}

export interface StudentDashboardData {
  courses: { code: string; title: string }[];
  attendance: { course_id: string; course: string; title: string; percent: number | null; attended: number; sessions: number; below_threshold: boolean }[];
  attendance_threshold: number;
  unpaid_invoices: number;
  outstanding_amount_usd: number;
  face_enrolled: boolean;
}

export function useDashboard<T>() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<T>('/dashboard') });
}

// ------------------------------------------------------------------ pieces
/** A single headline number. Text stays in ink colours; no decoration. */
export function StatTile({ label, value, hint, to }: { label: string; value: ReactNode; hint?: ReactNode; to?: string }) {
  const body = (
    <>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </>
  );
  const cls = 'block rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200';
  return to ? <Link to={to} className={`${cls} transition hover:ring-brand-500`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/**
 * Attendance meter: one brand hue for magnitude; below the threshold the fill turns
 * red AND says so in words (never colour alone). The number is always printed.
 */
export function AttendanceMeter({ percent, low, threshold, label }: { percent: number | null; low: boolean; threshold: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? 'No sessions yet' : `${percent}%${low ? `, below ${threshold}%` : ''}`}
      >
        {percent !== null && (
          <div className={`h-full rounded-full ${low ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${Math.max(percent, 2)}%` }} />
        )}
        {/* threshold tick */}
        <div className="absolute inset-y-0 w-0.5 bg-slate-400/60" style={{ left: `${threshold}%` }} aria-hidden />
      </div>
      <span className={`w-12 text-right text-sm font-semibold ${low ? 'text-red-700' : 'text-slate-900'}`}>
        {percent === null ? '-' : `${percent}%`}
      </span>
      {/* Fixed-width slot, so every bar in a list has the same length with or without the warning. */}
      <span className="w-24 shrink-0">
        {low && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-800">Below {threshold}%</span>}
      </span>
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function greeting(name?: string | null): string {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  if (!name) return part;
  const words = name.trim().split(/\s+/);
  // "Dr. Musa Kamara" -> "Dr. Kamara"; "Aminata Sesay" -> "Aminata".
  const titled = words.length > 1 && /^(dr|mr|mrs|ms|miss|prof|rev)\.?$/i.test(words[0]);
  return `${part}, ${titled ? `${words[0]} ${words.at(-1)}` : words[0]}`;
}

export const usd = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
