/** Student: open sessions + attendance percentage and history per course (spec 11.3). */
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { OpenSessionsPanel } from '@/features/attendance/OpenSessionsPanel';
import { useMyAttendance } from '@/features/attendance/api';
import type { CourseAttendance } from '@/lib/types';

function CourseRow({ c }: { c: CourseAttendance }) {
  const [open, setOpen] = useState(false);
  const pct = c.percent;
  return (
    <li className="py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-4 text-left" aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="font-mono font-semibold text-brand-700">{c.course.code}</span>{' '}
          <span className="text-slate-800">{c.course.title}</span>
        </span>
        <span className="text-sm text-slate-500">{c.attended}/{c.total}</span>
        <span className="w-44">
          <span className="block h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <span className={`block h-full ${c.low ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${pct ?? 0}%` }} />
          </span>
        </span>
        <span className="w-16 text-right font-semibold text-slate-900">{pct === null ? '-' : `${pct}%`}</span>
        {c.low && <Badge tone="red">Low</Badge>}
        {open ? <ChevronUp className="size-4 text-slate-400" aria-hidden /> : <ChevronDown className="size-4 text-slate-400" aria-hidden />}
      </button>
      {open && (
        c.history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No sessions yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg bg-slate-50 px-4">
            {c.history.map((h) => (
              <li key={h.session_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-700">{new Date(h.opens_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {h.title}</span>
                {h.present ? <Badge tone="green">Present{h.method === 'manual' ? ' (manual)' : ''}</Badge>
                  : h.status === 'open' ? <Badge tone="amber">Open now</Badge> : <Badge tone="red">Absent</Badge>}
              </li>
            ))}
          </ul>
        )
      )}
    </li>
  );
}

export default function StudentAttendancePage() {
  const mine = useMyAttendance();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Attendance" description="Open sessions and your attendance in each course." />
      <OpenSessionsPanel showEmpty />
      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold text-slate-900">My attendance</h2>
        {mine.isPending ? (
          <div className="mt-4 space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : mine.isError ? (
          <ErrorState error={mine.error} onRetry={() => mine.refetch()} />
        ) : mine.data.length === 0 ? (
          <EmptyState title="No courses yet" message="You are not enrolled in any course yet." />
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">{mine.data.map((c) => <CourseRow key={c.course.id} c={c} />)}</ul>
        )}
      </section>
    </div>
  );
}
