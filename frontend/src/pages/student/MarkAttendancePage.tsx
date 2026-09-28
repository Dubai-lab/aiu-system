/** Student: mark attendance - class code, then face check with liveness (spec 11.2). */
import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, KeyRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/useAuth';
import { ErrorState, Skeleton } from '@/components/DataStates';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { attendanceKeys, useStudentSession } from '@/features/attendance/api';
import { FaceCapture, type CaptureStep, type CapturedFrame } from '@/features/face/FaceCapture';
import { api, ApiError } from '@/lib/api';
import { formatClock, useCountdown } from '@/lib/useCountdown';

const INSTRUCTIONS: Record<string, string> = {
  center: 'Look straight at the camera',
  turn_left: 'Turn your head to the LEFT',
  turn_right: 'Turn your head to the RIGHT',
};

export default function MarkAttendancePage() {
  const { sessionId = '' } = useParams();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const session = useStudentSession(sessionId);
  const left = useCountdown(session.data?.closes_at);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [codeOk, setCodeOk] = useState(false);
  const [done, setDone] = useState<{ message: string; at: string } | null>(null);
  const challengeId = useRef<string | null>(null);

  if (session.isPending) return <div className="mx-auto max-w-2xl space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-72 w-full" /></div>;
  if (session.isError) return <div className="mx-auto max-w-2xl rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={session.error} onRetry={() => session.refetch()} /></div>;
  const s = session.data;

  const back = (
    <Link to="/student" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
      <ArrowLeft className="size-4" aria-hidden /> Back to dashboard
    </Link>
  );
  const header = (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900"><span className="font-mono">{s.course.code}</span> - {s.course.title}</h1>
      <p className="mt-1 text-sm text-slate-500">{s.title}</p>
    </div>
  );

  // Success (just now, or already marked earlier)
  if (done || s.marked) {
    const at = new Date(done?.at ?? s.marked_at!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {back}
        <Card>
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="size-16 text-green-600" aria-hidden />
            <p className="mt-4 text-xl font-semibold text-slate-900" role="status">
              You're marked present for {s.course.code} at {at}.
            </p>
            <Link to="/student" className="mt-6 rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
              Back to dashboard
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (s.status !== 'open' || left <= 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {back}
        {header}
        <Card><p className="py-6 text-center text-slate-600">This attendance session has closed.</p></Card>
      </div>
    );
  }

  if (!profile?.face_enrolled) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {back}
        {header}
        <Card><p className="py-6 text-center text-red-700">Your face is not enrolled yet - please see the administrator.</p></Card>
      </div>
    );
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Enter the 6-digit code shown by your teacher.');
      return;
    }
    setChecking(true);
    setCodeError(null);
    try {
      await api.post(`/attendance/sessions/${s.id}/verify-code`, { code });
      setCodeOk(true);
    } catch (err) {
      setCodeError(err instanceof ApiError ? err.message : 'Could not check the code.');
    } finally {
      setChecking(false);
    }
  };

  const prepare = async (): Promise<CaptureStep[]> => {
    const ch = await api.post<{ challenge_id: string; steps: string[] }>('/attendance/challenge');
    challengeId.current = ch.challenge_id;
    return ch.steps.map((key) => ({ key, instruction: INSTRUCTIONS[key] ?? key }));
  };

  const onComplete = async (frames: CapturedFrame[]) => {
    const result = await api.post<{ message: string; marked_at: string }>(`/attendance/sessions/${s.id}/mark`, {
      code, challenge_id: challengeId.current, frames,
    });
    setDone({ message: result.message, at: result.marked_at });
    void qc.invalidateQueries({ queryKey: attendanceKeys.all });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-3">
        {header}
        <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
          <Clock className="size-4" aria-hidden /> closes in <span className="font-mono">{formatClock(left)}</span>
        </span>
      </div>

      <Card title="Step 1 - Class code" description="Enter the 6-digit code your teacher is showing in class.">
        {codeOk ? (
          <p className="flex items-center gap-2 text-sm font-medium text-green-700"><CheckCircle2 className="size-5" aria-hidden /> Code accepted</p>
        ) : (
          <form onSubmit={submitCode} className="flex flex-wrap items-start gap-3" noValidate>
            <div>
              <label htmlFor="class-code" className="sr-only">Class code</label>
              <input
                id="class-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? 'code-error' : undefined}
                className="w-44 rounded-lg border border-slate-300 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder="000000"
              />
              {codeError && <p id="code-error" role="alert" className="mt-2 max-w-sm text-sm text-red-600">{codeError}</p>}
            </div>
            <Button type="submit" loading={checking} icon={<KeyRound className="size-4" aria-hidden />} className="py-3.5">Check code</Button>
          </form>
        )}
      </Card>

      <Card title="Step 2 - Face check" description="Look at the camera, then turn your head when asked.">
        {codeOk ? (
          <FaceCapture mode="attendance" steps={[{ key: 'center', instruction: INSTRUCTIONS.center }, { key: 'turn', instruction: 'Turn your head' }]}
            prepare={prepare} onComplete={onComplete} startLabel="Start face check" />
        ) : (
          <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Enter the class code first. The camera turns on after that.</p>
        )}
      </Card>
    </div>
  );
}
