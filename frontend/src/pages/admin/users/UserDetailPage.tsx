/** Admin view of one user: details, courses, face status and account actions. */
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, KeyRound, Mail, Pencil, ScanFace, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/useAuth';
import { ErrorState, PageHeader, Skeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useRemoveFace } from '@/features/face/api';
import { useDepartments, useResendCredentials, useResetPassword, useUpdateUser, useUser } from '@/features/users/api';
import { ApiError } from '@/lib/api';
import type { UserDetail } from '@/lib/types';
import { formatDate, formatDateTime, LEVELS, ROLE_CONFIG } from './roleConfig';

type Pending = 'reset' | 'resend' | 'deactivate' | 'reactivate' | 'remove-face' | null;

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function Detail({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 text-sm text-slate-900 ${mono ? 'font-mono' : ''}`}>{value || '-'}</dd>
    </div>
  );
}

export default function UserDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const justRegistered = Boolean((location.state as { justRegistered?: boolean } | null)?.justRegistered);
  const { profile: me } = useAuth();
  // Set when an action queues a credentials email; the page then polls for its result.
  const [emailQueuedAt, setEmailQueuedAt] = useState<number | undefined>(() => (justRegistered ? Date.now() : undefined));
  const user = useUser(id, emailQueuedAt);
  const reset = useResetPassword(id);
  const resend = useResendCredentials(id);
  const update = useUpdateUser(id);
  const removeFace = useRemoveFace(id);
  const [pending, setPending] = useState<Pending>(null);
  const [editing, setEditing] = useState(false);

  if (user.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-4" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (user.isError) {
    return (
      <div className="mx-auto max-w-5xl rounded-xl bg-white ring-1 ring-slate-200">
        <ErrorState error={user.error} onRetry={() => user.refetch()} />
      </div>
    );
  }

  const u = user.data;
  const cfg = ROLE_CONFIG[u.role];
  const isSelf = me?.id === u.id;
  const emailFailed = u.credentials_email?.status === 'failed';

  const run = async (action: Exclude<Pending, null>) => {
    try {
      if (action === 'reset') {
        setEmailQueuedAt(Date.now());
        await reset.mutateAsync();
        toast.success(`Password reset. A new default password is being emailed to ${u.email}.`);
      } else if (action === 'resend') {
        setEmailQueuedAt(Date.now());
        await resend.mutateAsync();
        toast.success(`Login details are being re-sent to ${u.email}.`);
      } else if (action === 'remove-face') {
        await removeFace.mutateAsync();
        toast.success(`Face data removed for ${u.full_name}.`);
      } else {
        await update.mutateAsync({ is_active: action === 'reactivate' });
        toast.success(action === 'reactivate' ? `${u.full_name} can log in again.` : `${u.full_name} has been deactivated.`);
      }
      setPending(null);
    } catch (err) {
      toast.error(errorMessage(err, 'The action failed. Please try again.'));
    }
  };
  const busy = reset.isPending || resend.isPending || update.isPending || removeFace.isPending;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to={cfg.listPath} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Back to {cfg.title.toLowerCase()}
      </Link>

      <PageHeader
        title={u.full_name}
        description={u.role === 'student' ? `${u.reg_number} · Student` : `${u.staff_title ?? cfg.singular} · ${u.email}`}
        actions={
          <>
            <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="secondary" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setPending('reset')}>Reset password</Button>
            {u.is_active ? (
              <Button variant="danger" icon={<UserX className="size-4" aria-hidden />} onClick={() => setPending('deactivate')} disabled={isSelf}
                title={isSelf ? 'You cannot deactivate your own account' : undefined}>
                Deactivate
              </Button>
            ) : (
              <Button icon={<UserCheck className="size-4" aria-hidden />} onClick={() => setPending('reactivate')}>Reactivate</Button>
            )}
          </>
        }
      />

      {justRegistered && (
        <div role="status" className="flex flex-wrap gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <CheckCircle2 className="size-5 shrink-0 text-green-600" aria-hidden />
          <p>
            Registration complete. Login details are being emailed to <strong>{u.email}</strong>.
            {u.role === 'student' && <> Their registration number is <strong className="font-mono">{u.reg_number}</strong>.</>}
          </p>
          {!u.face_enrolled && u.is_active && (
            <Link to={`/admin/users/${u.id}/face-enrollment`}
              className="ml-auto inline-flex shrink-0 items-center gap-2 self-center rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
              <ScanFace className="size-4" aria-hidden /> Enroll face now
            </Link>
          )}
        </div>
      )}

      {emailFailed && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden />
          <p className="flex-1">
            <strong>Credentials email failed</strong> ({formatDateTime(u.credentials_email!.created_at)}). The user has not received their login details.
          </p>
          <Button variant="secondary" icon={<Mail className="size-4" aria-hidden />} onClick={() => setPending(u.must_change_password ? 'resend' : 'reset')}>
            Resend
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}
        {u.face_enrolled ? <Badge tone="green">Face enrolled</Badge> : <Badge tone="slate">Face not enrolled</Badge>}
        {u.must_change_password && <Badge tone="amber">Still using default password</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-5 sm:grid-cols-2">
            <Detail label="Full name" value={u.full_name} />
            <Detail label="Email" value={u.email} />
            {u.role === 'student' ? (
              <>
                <Detail label="Registration number" value={u.reg_number} mono />
                <Detail label="Level" value={u.level} />
                <Detail label="Intake year" value={u.intake_year} />
              </>
            ) : (
              <Detail label="Title" value={u.staff_title} />
            )}
            <Detail label="Department" value={u.department ? `${u.department.name} (${u.department.code})` : null} />
            <Detail label="Phone" value={u.phone} />
            <Detail label="Registered" value={formatDate(u.created_at)} />
          </dl>
        </Card>

        <div className="space-y-6">
          <Card title="Face ID">
            <div className="flex gap-3 text-sm text-slate-600">
              <ScanFace className={`size-5 shrink-0 ${u.face_enrolled ? 'text-green-600' : 'text-slate-400'}`} aria-hidden />
              <p>{u.face_enrolled ? 'Face enrolled for login and attendance.' : 'No face enrolled yet.'}</p>
            </div>
            {u.is_active ? (
              <div className="mt-4 flex flex-col gap-2">
                <Link to={`/admin/users/${u.id}/face-enrollment`}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
                  <ScanFace className="size-4" aria-hidden /> {u.face_enrolled ? 'Re-enroll face' : 'Enroll face'}
                </Link>
                {u.face_enrolled && (
                  <Button variant="secondary" onClick={() => setPending('remove-face')}>Remove face data</Button>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">Reactivate the account to manage face data.</p>
            )}
          </Card>

          <Card title="Login details email">
            {emailQueuedAt && (!u.credentials_email || new Date(u.credentials_email.created_at).getTime() < emailQueuedAt - 5_000) &&
              Date.now() - emailQueuedAt < 30_000 ? (
              <p className="text-sm text-slate-500" role="status">Sending…</p>
            ) : u.credentials_email ? (
              <p className="text-sm text-slate-600">
                Last attempt {formatDateTime(u.credentials_email.created_at)}{' '}
                {u.credentials_email.status === 'sent' ? <Badge tone="green">Sent</Badge> : <Badge tone="red">Failed</Badge>}
              </p>
            ) : (
              <p className="text-sm text-slate-500">No login details email on record.</p>
            )}
            {u.must_change_password && (
              <Button variant="secondary" className="mt-4 w-full" icon={<Mail className="size-4" aria-hidden />} onClick={() => setPending('resend')}>
                Resend login details
              </Button>
            )}
          </Card>
        </div>
      </div>

      {u.role !== 'admin' && (
        <Card title={u.role === 'student' ? 'Enrolled courses' : 'Courses taught'}>
          {u.courses.length === 0 ? (
            <p className="text-sm text-slate-500">{u.role === 'student' ? 'Not enrolled in any course yet.' : 'Not assigned to any course yet.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {u.courses.map((c) => (
                <li key={c.id} className="flex gap-3 py-2 text-sm">
                  <Link to={`/admin/courses/${c.id}`} className="font-mono font-medium text-brand-700 hover:underline">{c.code}</Link>
                  <span className="text-slate-700">{c.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={pending === 'reset'}
        title="Reset password?"
        message={<>A new default password will be generated and emailed to <strong>{u.email}</strong>. Their current password will stop working immediately.</>}
        confirmLabel="Reset password"
        loading={busy}
        onConfirm={() => run('reset')}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'resend'}
        title="Resend login details?"
        message={<>A fresh default password will be generated and emailed to <strong>{u.email}</strong> with their login details. Any previously emailed password will stop working.</>}
        confirmLabel="Resend"
        loading={busy}
        onConfirm={() => run('resend')}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'deactivate'}
        title={`Deactivate ${u.full_name}?`}
        message="They will be logged out and will not be able to log in, by password or face, until reactivated. Their records are kept."
        confirmLabel="Deactivate"
        tone="danger"
        loading={busy}
        onConfirm={() => run('deactivate')}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'reactivate'}
        title={`Reactivate ${u.full_name}?`}
        message="They will be able to log in again with their existing password."
        confirmLabel="Reactivate"
        loading={busy}
        onConfirm={() => run('reactivate')}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'remove-face'}
        title="Remove face data?"
        message={<>The stored face signature for <strong>{u.full_name}</strong> will be deleted. They will not be able to log in or mark attendance with their face until enrolled again.</>}
        confirmLabel="Remove face data"
        tone="danger"
        loading={busy}
        onConfirm={() => run('remove-face')}
        onCancel={() => setPending(null)}
      />
      {editing && <EditUserDialog user={u} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditUserDialog({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const departments = useDepartments();
  const update = useUpdateUser(user.id);
  const isStudent = user.role === 'student';
  const [form, setForm] = useState({
    full_name: user.full_name,
    phone: user.phone ?? '',
    department_id: user.department?.id ?? '',
    level: String(user.level ?? ''),
    staff_title: user.staff_title ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.full_name.trim().length < 2) {
      setError('Enter the full name.');
      return;
    }
    try {
      await update.mutateAsync({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        department_id: form.department_id || null,
        ...(isStudent ? { level: Number(form.level) } : { staff_title: form.staff_title.trim() || null }),
      });
      toast.success('Details saved.');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the changes.'));
    }
  };

  return (
    <Dialog open onClose={onClose} title="Edit details">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField label="Full name" value={form.full_name} onChange={set('full_name')} />
        <TextField label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
        <SelectField label="Department" value={form.department_id} onChange={set('department_id')}
          placeholder={user.role === 'admin' ? 'No department' : undefined}
          options={(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))} />
        {isStudent ? (
          <SelectField label="Level" value={form.level} onChange={set('level')} options={LEVELS.map((l) => ({ value: String(l), label: `Level ${l}` }))} />
        ) : (
          <TextField label="Title" value={form.staff_title} onChange={set('staff_title')} />
        )}
        <p className="text-xs text-slate-500">Email and role cannot be changed.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>Cancel</Button>
          <Button type="submit" loading={update.isPending}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}
