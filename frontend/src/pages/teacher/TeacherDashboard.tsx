/** Teacher dashboard (spec 14.1): my courses, any open session ('Go to live session'),
 *  recent session attendance rates, 'Start attendance' quick button. */
import { Link } from 'react-router-dom';
import { BookOpen, Play, Radio, Users } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { ErrorState, Skeleton } from '@/components/DataStates';
import { AttendanceMeter, greeting, Section, useDashboard, type TeacherDashboardData } from '@/features/dashboard/components';
import { useRealtime } from '@/lib/useRealtime';
import { formatClock, useCountdown } from '@/lib/useCountdown';
import { useQueryClient } from '@tanstack/react-query';

function LiveBanner({ s }: { s: TeacherDashboardData['open_sessions'][number] }) {
  const left = useCountdown(s.closes_at);
  if (left <= 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-brand-700 p-5 text-white shadow-sm">
      <Radio className="size-7 animate-pulse text-accent-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-100">Attendance is live</p>
        <p className="text-lg font-semibold">{s.course} · {s.course_title}</p>
        <p className="text-sm text-brand-100">{s.present} of {s.enrolled} present · closes in <span className="font-mono">{formatClock(left)}</span></p>
      </div>
      <Link to={`/teacher/attendance/${s.id}`} className="rounded-lg bg-white px-5 py-3 text-base font-semibold text-brand-700 hover:bg-brand-50">
        Go to live session
      </Link>
    </div>
  );
}

export default function TeacherDashboard() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const dash = useDashboard<TeacherDashboardData>();
  // Keep the live banner and counts current.
  useRealtime({ table: 'attendance_sessions', onChange: () => void qc.invalidateQueries({ queryKey: ['dashboard'] }) });

  const start = (
    <Link to="/teacher/attendance/new" className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
      <Play className="size-4" aria-hidden /> Start attendance
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{greeting(profile?.full_name)}</h1>
          <p className="mt-1 text-sm text-slate-500">Your courses and attendance at a glance.</p>
        </div>
        {start}
      </div>

      {dash.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-48 w-full rounded-xl" /></div>
      ) : dash.isError ? (
        <div className="rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={dash.error} onRetry={() => dash.refetch()} /></div>
      ) : (
        <>
          {dash.data.open_sessions.map((s) => <LiveBanner key={s.id} s={s} />)}

          <Section title="My courses" action={<Link to="/teacher/courses" className="text-sm text-brand-700 hover:underline">All courses</Link>}>
            {dash.data.courses.length === 0 ? (
              <p className="text-sm text-slate-500">You are not assigned to any course yet. The administrator assigns teachers to courses.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {dash.data.courses.map((c) => (
                  <li key={c.id} className="rounded-lg p-4 ring-1 ring-slate-200">
                    <Link to={`/teacher/courses/${c.id}`} className="flex items-start gap-2 hover:underline">
                      <BookOpen className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
                      <span><span className="font-mono font-semibold text-brand-700">{c.code}</span> <span className="text-slate-800">{c.title}</span></span>
                    </Link>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-slate-600"><Users className="size-4" aria-hidden /> {c.students} student{c.students === 1 ? '' : 's'}</span>
                      <Link to={`/teacher/attendance/new?course=${c.id}`} className="font-medium text-brand-700 hover:underline">Start attendance</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent sessions" action={<Link to="/teacher/attendance" className="text-sm text-brand-700 hover:underline">History</Link>}>
            {dash.data.recent_sessions.length === 0 ? (
              <p className="text-sm text-slate-500">No finished sessions yet.</p>
            ) : (
              <ul className="space-y-3">
                {dash.data.recent_sessions.map((s) => (
                  <li key={s.id} className="grid gap-1 sm:grid-cols-[220px_1fr] sm:items-center sm:gap-4">
                    <Link to={`/teacher/attendance/${s.id}`} className="text-sm hover:underline">
                      <span className="font-mono font-semibold text-brand-700">{s.course}</span>{' '}
                      <span className="text-slate-600">{new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {s.present}/{s.enrolled}</span>
                    </Link>
                    <AttendanceMeter percent={s.rate_percent} low={s.rate_percent !== null && s.rate_percent < 75} threshold={75}
                      label={`${s.course} attendance on ${new Date(s.date).toLocaleDateString()}`} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
