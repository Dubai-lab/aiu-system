/** Student dashboard (spec 14.1): open attendance sessions (realtime, most prominent),
 *  courses with attendance %, outstanding invoices with Pay buttons. */
import { Link } from 'react-router-dom';
import { ScanFace } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { ErrorState, Skeleton } from '@/components/DataStates';
import { OpenSessionsPanel } from '@/features/attendance/OpenSessionsPanel';
import { AttendanceMeter, greeting, Section, useDashboard, type StudentDashboardData } from '@/features/dashboard/components';
import { OutstandingInvoicesPanel } from '@/features/finance/OutstandingInvoicesPanel';

export default function StudentDashboard() {
  const { profile } = useAuth();
  const dash = useDashboard<StudentDashboardData>();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{greeting(profile?.full_name)}</h1>
        <p className="mt-1 text-sm text-slate-500">{profile?.reg_number} · {profile?.department?.name ?? 'Student'}</p>
      </div>

      {/* Open attendance sessions first - they appear here the moment a teacher starts one. */}
      <OpenSessionsPanel />

      {profile && !profile.face_enrolled && (
        <p className="flex items-center gap-3 rounded-xl bg-white p-4 text-sm text-slate-600 ring-1 ring-slate-200">
          <ScanFace className="size-5 shrink-0 text-slate-400" aria-hidden />
          Your face is not enrolled yet - please see the administrator. You need it to mark attendance and to log in with Face ID.
        </p>
      )}

      <Section title="My attendance" action={<Link to="/student/attendance" className="text-sm text-brand-700 hover:underline">Details</Link>}>
        {dash.isPending ? (
          <div className="space-y-3" role="status" aria-label="Loading"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div>
        ) : dash.isError ? (
          <ErrorState error={dash.error} onRetry={() => dash.refetch()} />
        ) : dash.data.attendance.length === 0 ? (
          <p className="text-sm text-slate-500">You are not enrolled in any course yet.</p>
        ) : (
          <ul className="space-y-3">
            {dash.data.attendance.map((a) => (
              <li key={a.course_id} className="grid gap-1 sm:grid-cols-[260px_1fr] sm:items-center sm:gap-4">
                <span className="truncate text-sm">
                  <span className="font-mono font-semibold text-brand-700">{a.course}</span> <span className="text-slate-700">{a.title}</span>
                  <span className="block text-xs text-slate-500">{a.sessions ? `${a.attended} of ${a.sessions} sessions` : 'No sessions yet'}</span>
                </span>
                <AttendanceMeter percent={a.percent} low={a.below_threshold} threshold={dash.data.attendance_threshold} label={`${a.course} attendance`} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <OutstandingInvoicesPanel />
    </div>
  );
}
