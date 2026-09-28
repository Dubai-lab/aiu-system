/** Admin face enrollment for one user: consent, then a guided 5-photo capture (spec 10.4). */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState, PageHeader, Skeleton } from '@/components/DataStates';
import { Card } from '@/components/ui/Card';
import { ENROLL_STEPS, useEnrollFace, useFaceServiceStatus } from '@/features/face/api';
import { FaceCapture, type CapturedFrame } from '@/features/face/FaceCapture';
import { useUser } from '@/features/users/api';

export default function FaceEnrollmentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const user = useUser(id);
  const service = useFaceServiceStatus();
  const enroll = useEnrollFace(id);
  const [consent, setConsent] = useState(false);

  if (user.isPending) return <div className="mx-auto max-w-3xl space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-96 w-full" /></div>;
  if (user.isError) return <div className="mx-auto max-w-3xl rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={user.error} onRetry={() => user.refetch()} /></div>;

  const u = user.data;
  const serviceOffline = service.isSuccess && !service.data.model_loaded;
  const onComplete = async (frames: CapturedFrame[]) => {
    await enroll.mutateAsync(frames); // errors are shown inside FaceCapture with "Try again"
    toast.success(`Face ${u.face_enrolled ? 're-enrolled' : 'enrolled'} for ${u.full_name}.`);
    navigate(`/admin/users/${u.id}`);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={`/admin/users/${u.id}`} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Back to {u.full_name}
      </Link>
      <PageHeader
        title={`${u.face_enrolled ? 'Re-enroll' : 'Enroll'} face: ${u.full_name}`}
        description={`${u.role === 'student' ? u.reg_number : u.email}. The person must be sitting at this computer.`}
      />

      {!u.is_active && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This account is deactivated. Reactivate it before enrolling a face.
        </div>
      )}
      {u.face_enrolled && (
        <div role="status" className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden />
          A face is already enrolled. Completing this replaces it.
        </div>
      )}
      {serviceOffline && (
        <div role="alert" className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="size-5 shrink-0" aria-hidden />
          The face recognition service is not running. Start it, then this page will continue automatically.
        </div>
      )}

      <Card>
        <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-4 hover:bg-slate-50">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-brand-700"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={!u.is_active}
          />
          <span className="text-sm text-slate-700">
            <span className="flex items-center gap-1.5 font-medium text-slate-900">
              <ShieldCheck className="size-4 text-brand-700" aria-hidden /> Consent
            </span>
            {u.full_name} agrees to their face data being used for login and attendance. Only a numeric face
            signature is stored - no photos are kept.
          </span>
        </label>

        <div className="mt-6">
          {consent ? (
            <FaceCapture
              mode="enroll"
              steps={ENROLL_STEPS}
              onComplete={onComplete}
              startLabel="Start capture (5 photos)"
              disabled={!u.is_active || serviceOffline}
            />
          ) : (
            <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Tick the consent box to turn on the camera.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
