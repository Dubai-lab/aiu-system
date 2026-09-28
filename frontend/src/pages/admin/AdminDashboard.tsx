/** Admin dashboard (spec 14.1): totals, today's attendance, invoices, recent registrations,
 *  failed emails, users without face enrollment. */
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, ScanFace, ScrollText, UserPlus } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { ErrorState, Skeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { greeting, Section, StatTile, useDashboard, usd, type AdminDashboardData, type DashPerson } from '@/features/dashboard/components';

const quick = 'inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50';

function PersonRow({ p, action }: { p: DashPerson; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <Link to={`/admin/users/${p.id}`} className="block truncate text-sm font-medium text-slate-900 hover:underline">{p.full_name}</Link>
        <span className="block truncate text-xs text-slate-500">{p.reg_number ?? p.email}</span>
      </span>
      <Badge tone={p.role === 'teacher' ? 'green' : 'blue'}>{p.role === 'teacher' ? 'Teacher' : 'Student'}</Badge>
      {action}
    </li>
  );
}

export default function AdminDashboard() {
  const { profile } = useAuth();
  const dash = useDashboard<AdminDashboardData>();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{greeting(profile?.full_name)}</h1>
          <p className="mt-1 text-sm text-slate-500">Here's what is happening across the university today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/students/new" className={quick}><UserPlus className="size-4" aria-hidden /> Register student</Link>
          <Link to="/admin/reports/attendance" className={quick}><BarChart3 className="size-4" aria-hidden /> Attendance report</Link>
          <Link to="/admin/audit-logs" className={quick}><ScrollText className="size-4" aria-hidden /> Audit log</Link>
        </div>
      </div>

      {dash.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : dash.isError ? (
        <div className="rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={dash.error} onRetry={() => dash.refetch()} /></div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Students" value={dash.data.students} to="/admin/students" />
            <StatTile label="Teachers" value={dash.data.teachers} to="/admin/teachers" />
            <StatTile label="Active courses" value={dash.data.courses} hint={`${dash.data.departments} departments`} to="/admin/courses" />
            <StatTile
              label="Attendance today"
              value={dash.data.attendance_rate_today_percent === null ? '-' : `${dash.data.attendance_rate_today_percent}%`}
              hint={dash.data.attendance_sessions_today
                ? `${dash.data.attendance_sessions_today} session${dash.data.attendance_sessions_today === 1 ? '' : 's'} so far`
                : 'No sessions today yet'}
              to="/admin/reports/attendance"
            />
            <StatTile label="Unpaid invoices" value={dash.data.unpaid_invoices} hint={`${usd(dash.data.unpaid_total_usd)} outstanding`} to="/admin/invoices" />
            <StatTile label="Paid (simulated)" value={usd(dash.data.paid_total_usd)} hint={`${dash.data.paid_invoices} invoices`} to="/admin/invoices" />
            <StatTile label="Without face enrollment" value={dash.data.users_without_face} hint="Active users" />
            <StatTile label="Failed emails" value={dash.data.failed_emails} hint={dash.data.failed_emails ? 'Need a resend' : 'All delivered'} to="/admin/email-logs" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Section title="Recent registrations" action={<Link to="/admin/students" className="text-sm text-brand-700 hover:underline">All users</Link>}>
              {dash.data.recent_registrations.length === 0 ? (
                <p className="text-sm text-slate-500">No students or teachers yet. <Link to="/admin/students/new" className="text-brand-700 hover:underline">Register one</Link>.</p>
              ) : (
                <ul className="divide-y divide-slate-100">{dash.data.recent_registrations.map((p) => <PersonRow key={p.id} p={p} />)}</ul>
              )}
            </Section>

            <Section title="Needs face enrollment">
              {dash.data.users_without_face_list.length === 0 ? (
                <p className="text-sm text-slate-500">Everyone has a face enrolled.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {dash.data.users_without_face_list.map((p) => (
                    <PersonRow key={p.id} p={p} action={
                      <Link to={`/admin/users/${p.id}/face-enrollment`} className="rounded-md p-1.5 text-brand-700 hover:bg-slate-100" aria-label={`Enroll face for ${p.full_name}`}>
                        <ScanFace className="size-4" aria-hidden />
                      </Link>
                    } />
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Failed emails" action={<Link to="/admin/email-logs" className="text-sm text-brand-700 hover:underline">Email log</Link>}>
              {dash.data.failed_email_list.length === 0 ? (
                <p className="text-sm text-slate-500">No failed emails.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {dash.data.failed_email_list.map((e) => (
                    <li key={e.id} className="flex items-start gap-2 py-2 text-sm">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
                      <span className="min-w-0 flex-1">
                        {e.related_user_id
                          ? <Link to={`/admin/users/${e.related_user_id}`} className="block truncate font-medium text-slate-900 hover:underline">{e.to_email}</Link>
                          : <span className="block truncate font-medium text-slate-900">{e.to_email}</span>}
                        <span className="block text-xs text-slate-500">{e.template.replace(/_/g, ' ')} · {new Date(e.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
