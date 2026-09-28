/** Teacher: attendance session history + quick access to an open session. */
import { Link, useNavigate } from 'react-router-dom';
import { Play, Radio } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { useTeacherSessions } from '@/features/attendance/api';
import type { SessionSummary } from '@/lib/types';
import { formatClock, useCountdown } from '@/lib/useCountdown';

function OpenBanner({ s }: { s: SessionSummary }) {
  const left = useCountdown(s.closes_at);
  if (left <= 0) return null;
  return (
    <Link to={`/teacher/attendance/${s.id}`}
      className="flex flex-wrap items-center gap-4 rounded-xl bg-brand-700 p-5 text-white shadow-sm hover:bg-brand-800">
      <Radio className="size-6 animate-pulse text-accent-400" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold uppercase tracking-wide text-brand-100">Live now</span>
        <span className="block text-lg font-semibold">{s.course.code} · {s.title}</span>
      </span>
      <span className="text-sm">{s.present_count}/{s.enrolled_count} present · closes in <span className="font-mono">{formatClock(left)}</span></span>
      <span className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-700">Go to live session</span>
    </Link>
  );
}

export default function TeacherAttendancePage() {
  const sessions = useTeacherSessions();
  const navigate = useNavigate();
  const startButton = (
    <Link to="/teacher/attendance/new" className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
      <Play className="size-4" aria-hidden /> Start attendance
    </Link>
  );
  const open = (sessions.data ?? []).filter((s) => s.status === 'open');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Attendance" description="Start a session, then students mark themselves with the class code and a face check." actions={startButton} />
      {open.map((s) => <OpenBanner key={s.id} s={s} />)}
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <h2 className="border-b border-slate-200 px-5 py-4 font-semibold text-slate-900">Session history</h2>
        {sessions.isPending ? (
          <TableSkeleton />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : sessions.data.length === 0 ? (
          <EmptyState title="No sessions yet" message="Start your first attendance session." action={startButton} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Date</th>
                  <th scope="col" className="px-5 py-3 font-medium">Course</th>
                  <th scope="col" className="px-5 py-3 font-medium">Title</th>
                  <th scope="col" className="px-5 py-3 font-medium">Present</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.data.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/teacher/attendance/${s.id}`)}>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-700">
                      <Link to={`/teacher/attendance/${s.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                        {new Date(s.opens_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono font-semibold text-brand-700">{s.course.code}</td>
                    <td className="px-5 py-3 text-slate-700">{s.title}</td>
                    <td className="px-5 py-3 text-slate-700">{s.present_count}/{s.enrolled_count}</td>
                    <td className="px-5 py-3">{s.status === 'open' ? <Badge tone="green">Open</Badge> : <Badge tone="slate">Closed</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
