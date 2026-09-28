/** Registration form for a student, teacher or administrator (spec 8.1). */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/DataStates';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useDepartments, useRegisterUser, type RegisterPayload } from '@/features/users/api';
import { ApiError } from '@/lib/api';
import type { Role } from '@/lib/types';
import { LEVELS, ROLE_CONFIG } from './roleConfig';

type Errors = Partial<Record<'full_name' | 'email' | 'department_id' | 'level' | 'intake_year' | 'form', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterUserPage({ role }: { role: Role }) {
  const cfg = ROLE_CONFIG[role];
  const navigate = useNavigate();
  const departments = useDepartments();
  const register = useRegisterUser(role);
  const isStudent = role === 'student';
  const thisYear = new Date().getFullYear();

  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', department_id: '', level: '', intake_year: String(thisYear), staff_title: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = (): Errors => {
    const found: Errors = {};
    if (form.full_name.trim().length < 2) found.full_name = 'Enter the full name.';
    if (!EMAIL_RE.test(form.email.trim())) found.email = 'Enter a valid email address.';
    if (role !== 'admin' && !form.department_id) found.department_id = 'Choose a department.';
    if (isStudent && !form.level) found.level = 'Choose a level.';
    const year = Number(form.intake_year);
    if (isStudent && (!Number.isInteger(year) || year < 2000 || year > 2100)) found.intake_year = 'Enter a valid year.';
    return found;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    const payload: RegisterPayload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      department_id: form.department_id || null,
      ...(isStudent
        ? { level: Number(form.level), intake_year: Number(form.intake_year) }
        : { staff_title: form.staff_title.trim() || null }),
    };
    try {
      const user = await register.mutateAsync(payload);
      toast.success(`${user.full_name} registered. Login details are being emailed to ${user.email}.`);
      navigate(`/admin/users/${user.id}`, { state: { justRegistered: true } });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Registration failed. Please try again.';
      if (err instanceof ApiError && err.code === 'email_taken') setErrors({ email: message });
      else if (err instanceof ApiError && err.code.startsWith('department')) setErrors({ department_id: message });
      else setErrors({ form: message });
      toast.error(message);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={cfg.listPath} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Back to {cfg.title.toLowerCase()}
      </Link>
      <PageHeader title={`Register ${cfg.singular}`} description="A unique default password is generated and emailed to them." />

      <Card>
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField className="sm:col-span-2" label="Full name" value={form.full_name} onChange={set('full_name')} error={errors.full_name} autoComplete="off" />
            <TextField label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="off"
              hint="Login details are sent to this address." />
            <TextField label="Phone (optional)" type="tel" value={form.phone} onChange={set('phone')} autoComplete="off" />
            <SelectField
              className={isStudent ? 'sm:col-span-2' : ''}
              label={role === 'admin' ? 'Department (optional)' : 'Department'}
              value={form.department_id}
              onChange={set('department_id')}
              error={errors.department_id}
              placeholder={departments.isPending ? 'Loading…' : 'Choose a department'}
              options={(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))}
            />
            {isStudent ? (
              <>
                <SelectField label="Level" value={form.level} onChange={set('level')} error={errors.level} placeholder="Choose a level"
                  options={LEVELS.map((l) => ({ value: String(l), label: `Level ${l}` }))} />
                <TextField label="Intake year" type="number" inputMode="numeric" value={form.intake_year} onChange={set('intake_year')}
                  error={errors.intake_year} hint="Used in the registration number, e.g. AIU-2026-0001." />
              </>
            ) : (
              <TextField label="Title (optional)" value={form.staff_title} onChange={set('staff_title')}
                placeholder={role === 'admin' ? 'e.g. Dean of Computing' : 'e.g. Senior Lecturer'} />
            )}
          </div>

          {errors.form && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.form}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Mail className="size-4" aria-hidden />
              {isStudent ? 'The registration number is generated automatically.' : 'They log in with their email.'}
            </p>
            <Button type="submit" loading={register.isPending}>Register {cfg.singular}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
