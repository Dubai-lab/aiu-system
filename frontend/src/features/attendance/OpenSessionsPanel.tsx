/**
 * Student: open attendance sessions for enrolled courses (spec 11.2 step 1).
 * Appears instantly via Supabase Realtime; each card counts down and disappears
 * when the session closes.
 */
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, ScanFace } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Skeleton } from '@/components/DataStates';
import type { StudentSession } from '@/lib/types';
import { formatClock, useCountdown } from '@/lib/useCountdown';
import { useOpenSessions } from './api';

function SessionCard({ session, faceEnrolled }: { session: StudentSession; faceEnrolled: boolean }) {
  const left = useCountdown(session.closes_at);
  if (left <= 0 && !session.marked) return null; // closed while on screen
  return (
    <div className={`flex flex-wrap items-center gap-4 rounded-xl p-5 shadow-sm ring-2 ${session.marked ? 'bg-green-50 ring-green-200' : 'bg-amber-50 ring-accent-400'}`}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance open</p>
        <p className="mt-1 text-lg font-semibold text-slate-900">
          <span className="font-mono">{session.course.code}</span> - {session.course.title}
        </p>
        <p className="text-sm text-slate-600">{session.title}</p>
      </div>
      {session.marked ? (
        <p className="flex items-center gap-2 font-medium text-green-700">
          <CheckCircle2 className="size-5" aria-hidden /> Marked present at{' '}
          {new Date(session.marked_at!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700" aria-label={`Closes in ${formatClock(left)}`}>
            <Clock className="size-4" aria-hidden /> closes in <span className="font-mono text-base">{formatClock(left)}</span>
          </span>
          {faceEnrolled ? (
            <Link to={`/student/attendance/${session.id}/mark`}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800">
              <ScanFace className="size-4" aria-hidden /> Mark attendance
            </Link>
          ) : (
            <p className="max-w-xs text-sm text-red-700">Your face is not enrolled yet - please see the administrator.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function OpenSessionsPanel({ showEmpty = false }: { showEmpty?: boolean }) {
  const { profile } = useAuth();
  const sessions = useOpenSessions();
  if (sessions.isPending) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (sessions.isError) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not load open attendance sessions. <button type="button" className="underline" onClick={() => sessions.refetch()}>Try again</button>
      </p>
    );
  }
  if (sessions.data.length === 0) {
    return showEmpty ? (
      <p className="rounded-xl bg-white px-5 py-4 text-sm text-slate-500 ring-1 ring-slate-200">
        No attendance is open right now. When your teacher starts one, it appears here instantly.
      </p>
    ) : null;
  }
  return (
    <section aria-label="Open attendance sessions" className="space-y-3">
      {sessions.data.map((s) => <SessionCard key={s.id} session={s} faceEnrolled={Boolean(profile?.face_enrolled)} />)}
    </section>
  );
}
