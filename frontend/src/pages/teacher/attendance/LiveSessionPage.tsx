/**
 * Teacher: live attendance session (spec 11.1) - huge class code for the
 * projector, countdown, and Present / Not yet marked lists that update in real
 * time. Actions: extend, new code, close now, mark manually (with a reason).
 */
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, Maximize2, Minimize2, Plus, RefreshCw, Square, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState, Skeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useLiveSession, useManualMark, useUpdateSession } from '@/features/attendance/api';
import { ApiError } from '@/lib/api';
import type { SessionDetail } from '@/lib/types';
import { formatClock, useCountdown } from '@/lib/useCountdown';

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function ManualMarkDialog({ session, onClose }: { session: SessionDetail; onClose: () => void }) {
  const mark = useManualMark(session.id);
  const [studentId, setStudentId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!studentId) return setError('Choose a student.');
    if (reason.trim().length < 3) return setError('A reason is required, e.g. "camera not working".');
    try {
      await mark.mutateAsync({ student_id: studentId, reason: reason.trim() });
      toast.success('Marked present manually.');
      onClose();
    } catch (err) {
      setError(message(err, 'Could not mark the student.'));
    }
  };
  return (
    <Dialog open onClose={onClose} title="Mark a student manually">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <SelectField label="Student" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="Choose a student"
          options={session.absent.map((s) => ({ value: s.id, label: `${s.full_name} (${s.reg_number})` }))} />
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. camera not working" maxLength={300}
          hint="Saved with the record and in the audit log." />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={mark.isPending}>Cancel</Button>
          <Button type="submit" loading={mark.isPending}>Mark present</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function LiveSessionPage() {
  const { sessionId = '' } = useParams();
  const live = useLiveSession(sessionId);
  const update = useUpdateSession(sessionId);
  const left = useCountdown(live.data?.status === 'open' ? live.data.closes_at : null);
  const [manual, setManual] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [projector, setProjector] = useState(false);

  if (live.isPending) return <div className="mx-auto max-w-6xl space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-64 w-full" /></div>;
  if (live.isError) return <div className="mx-auto max-w-6xl rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={live.error} onRetry={() => live.refetch()} /></div>;
  const s = live.data;
  const isOpen = s.status === 'open' && left > 0;

  const act = async (body: { action: 'extend' | 'regenerate_code' | 'close'; minutes?: number }, success: string) => {
    try {
      await update.mutateAsync(body);
      toast.success(success);
    } catch (err) {
      toast.error(message(err, 'The action failed.'));
    }
  };

  const codeBlock = (
    <div className={`flex flex-col items-center justify-center rounded-2xl bg-brand-700 text-white ${projector ? 'fixed inset-0 z-50 rounded-none' : 'p-8'}`}>
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-100">{s.course.code} · Class code</p>
      <p className={`font-mono font-bold tracking-[0.15em] text-accent-400 ${projector ? 'text-[18vw] leading-none' : 'text-7xl sm:text-8xl'}`}
        aria-label={`Class code ${s.code?.split('').join(' ')}`}>
        {isOpen ? s.code : '------'}
      </p>
      <p className={`mt-2 flex items-center gap-2 font-mono ${projector ? 'text-5xl' : 'text-2xl'}`}>
        <Clock className={projector ? 'size-10' : 'size-6'} aria-hidden /> {isOpen ? formatClock(left) : 'Closed'}
      </p>
      <p className={`mt-3 ${projector ? 'text-3xl' : 'text-base'} text-brand-100`}>{s.present_count} of {s.enrolled_count} present</p>
      <button type="button" onClick={() => setProjector((p) => !p)}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
        {projector ? <><Minimize2 className="size-4" aria-hidden /> Exit projector view</> : <><Maximize2 className="size-4" aria-hidden /> Projector view</>}
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to="/teacher/attendance" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Back to attendance
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{s.course.code} · {s.course.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{s.title} · started {time(s.opens_at)}</p>
        </div>
        {isOpen ? <Badge tone="green">Open</Badge> : <Badge tone="slate">Closed</Badge>}
      </div>

      {codeBlock}

      <div className="flex flex-wrap gap-2">
        {isOpen && (
          <>
            <Button variant="secondary" icon={<Plus className="size-4" aria-hidden />} loading={update.isPending && update.variables?.minutes === 5}
              onClick={() => act({ action: 'extend', minutes: 5 }, 'Extended by 5 minutes.')}>5 min</Button>
            <Button variant="secondary" icon={<Plus className="size-4" aria-hidden />} loading={update.isPending && update.variables?.minutes === 10}
              onClick={() => act({ action: 'extend', minutes: 10 }, 'Extended by 10 minutes.')}>10 min</Button>
            <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />}
              onClick={() => act({ action: 'regenerate_code' }, 'New class code created.')}>New code</Button>
          </>
        )}
        {/* Manual marking stays available after closing, for corrections (always audited). */}
        <Button variant="secondary" icon={<UserCheck className="size-4" aria-hidden />} onClick={() => setManual(true)} disabled={s.absent.length === 0}>
          Mark manually
        </Button>
        {isOpen && <Button variant="danger" icon={<Square className="size-4" aria-hidden />} onClick={() => setConfirmClose(true)}>Close now</Button>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200" aria-live="polite">
          <h2 className="flex items-center justify-between border-b border-slate-200 px-5 py-4 font-semibold text-slate-900">
            Present <Badge tone="green">{s.present.length}</Badge>
          </h2>
          {s.present.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No one yet. Students appear here the moment they are verified.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {s.present.map((r) => (
                <li key={r.student.id} className="flex items-center gap-3 px-5 py-3">
                  <CheckCircle2 className="size-5 shrink-0 text-green-600" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">{r.student.full_name}</span>
                    <span className="block text-xs text-slate-500">
                      <span className="font-mono">{r.student.reg_number}</span> · {time(r.marked_at)}
                      {r.method === 'manual' && <> · manual: {r.manual_reason}</>}
                    </span>
                  </span>
                  {r.method === 'face' && r.similarity !== null
                    ? <Badge tone="blue">face {Math.round(r.similarity * 100)}%</Badge>
                    : <Badge tone="amber">manual</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <h2 className="flex items-center justify-between border-b border-slate-200 px-5 py-4 font-semibold text-slate-900">
            {isOpen ? 'Not yet marked' : 'Absent'} <Badge tone={isOpen ? 'amber' : 'red'}>{s.absent.length}</Badge>
          </h2>
          {s.absent.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">{s.enrolled_count ? 'Everyone is present.' : 'No students are enrolled in this course.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {s.absent.map((p) => (
                <li key={p.id} className="px-5 py-3">
                  <span className="block font-medium text-slate-900">{p.full_name}</span>
                  <span className="block font-mono text-xs text-slate-500">{p.reg_number}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {manual && <ManualMarkDialog session={s} onClose={() => setManual(false)} />}
      <ConfirmDialog
        open={confirmClose}
        title="Close attendance now?"
        message={`Students who have not marked yet (${s.absent.length}) will be recorded as absent. You can still mark someone manually afterwards.`}
        confirmLabel="Close now"
        tone="danger"
        loading={update.isPending}
        onConfirm={async () => {
          await act({ action: 'close' }, 'Attendance closed.');
          setConfirmClose(false);
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}
