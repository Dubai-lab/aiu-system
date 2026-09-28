/** Profile page for every role: details, change password, face enrollment status. */
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ScanFace, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { meQueryKey } from '@/auth/AuthProvider';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { api, ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { ChangePasswordResponse, Me } from '@/lib/types';

/** Same rule as the backend: at least 8 characters, one letter and one number. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Include at least one letter and one number.';
  return null;
}

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value || '-'}</dd>
    </div>
  );
}

function ChangePasswordForm({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (!current) found.current = 'Enter your current password.';
    const problem = passwordProblem(next);
    if (problem) found.next = problem;
    else if (next === current) found.next = 'The new password must be different from the current one.';
    if (confirm !== next) found.confirm = 'The passwords do not match.';
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const res = await api.post<ChangePasswordResponse>('/me/password', { current_password: current, new_password: next });
      // Supabase ended every old session when the password changed; switch to the new one.
      const { error } = await supabase.auth.setSession({ access_token: res.access_token, refresh_token: res.refresh_token });
      if (error) throw new ApiError(0, 'session_error', 'Password changed. Please log in again with your new password.');
      toast.success(res.message);
      setCurrent('');
      setNext('');
      setConfirm('');
      await queryClient.invalidateQueries({ queryKey: meQueryKey(me.id) }); // hides the banner
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not change the password.';
      if (err instanceof ApiError && err.code === 'wrong_password') setErrors({ current: message });
      else setErrors({ form: message });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <TextField label="Current password" type="password" autoComplete="current-password"
        value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.current} />
      <TextField label="New password" type="password" autoComplete="new-password"
        value={next} onChange={(e) => setNext(e.target.value)} error={errors.next}
        hint="At least 8 characters, with a letter and a number." />
      <TextField label="Confirm new password" type="password" autoComplete="new-password"
        value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
      {errors.form && <p role="alert" className="text-sm text-red-600">{errors.form}</p>}
      <Button type="submit" loading={saving}>Change password</Button>
    </form>
  );
}

export default function ProfilePage() {
  const { profile } = useAuth();
  if (!profile) return null; // the layout guard guarantees a profile

  const isStudent = profile.role === 'student';
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">My Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Your personal details and account security.</p>
      </div>

      {profile.force_password_change && (
        <div role="alert" className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert className="size-5 shrink-0 text-amber-600" aria-hidden />
          Please change your default password before using the rest of the system.
        </div>
      )}

      <Card title="Personal information">
        <dl className="grid gap-5 sm:grid-cols-2">
          <Detail label="Full name" value={profile.full_name} />
          <Detail label="Email" value={profile.email} />
          {isStudent ? (
            <>
              <Detail label="Registration number" value={profile.reg_number} />
              <Detail label="Level" value={profile.level} />
              <Detail label="Intake year" value={profile.intake_year} />
            </>
          ) : (
            <Detail label="Title" value={profile.staff_title} />
          )}
          <Detail label="Department" value={profile.department ? `${profile.department.name} (${profile.department.code})` : null} />
          <Detail label="Phone" value={profile.phone} />
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Change password" description="You can change your password at any time.">
          <ChangePasswordForm me={profile} />
        </Card>

        <Card title="Face ID">
          {profile.face_enrolled ? (
            <p className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="size-5" aria-hidden /> Your face is enrolled. You can log in with Face ID.
            </p>
          ) : (
            <div className="flex gap-3 text-sm text-slate-600">
              <ScanFace className="size-5 shrink-0 text-slate-400" aria-hidden />
              <p>
                Your face is not enrolled yet. Please see the administrator to enroll it - then you can log in
                {isStudent ? ' and mark attendance' : ''} with Face ID.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
