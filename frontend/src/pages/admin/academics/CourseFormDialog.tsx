/** Create / edit a course. The teacher is assigned on the course page. */
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useSaveCourse } from '@/features/academics/api';
import { useDepartments } from '@/features/users/api';
import { ApiError } from '@/lib/api';
import type { Course, CourseDetail } from '@/lib/types';

const CODE_RE = /^[A-Z]{2,6}[0-9]{3}$/;

export function CourseFormDialog({ course, onClose, onSaved }: {
  course: Course | null;
  onClose: () => void;
  onSaved?: (course: CourseDetail) => void;
}) {
  const departments = useDepartments();
  const save = useSaveCourse();
  const [form, setForm] = useState({
    code: course?.code ?? '',
    title: course?.title ?? '',
    department_id: course?.department.id ?? '',
    credits: String(course?.credits ?? 3),
    semester: String(course?.semester ?? 1),
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form | 'form', string>>>({});
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const code = form.code.replace(/[\s_-]/g, '').toUpperCase();
    const found: typeof errors = {};
    if (!CODE_RE.test(code)) found.code = 'Use letters then 3 digits, e.g. CSC401.';
    if (form.title.trim().length < 2) found.title = 'Enter the course title.';
    if (!form.department_id) found.department_id = 'Choose a department.';
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const saved = await save.mutateAsync({
        id: course?.id,
        code,
        title: form.title.trim(),
        department_id: form.department_id,
        credits: Number(form.credits),
        semester: Number(form.semester),
      });
      toast.success(course ? 'Course updated.' : `${saved.code} created.`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not save the course.';
      if (err instanceof ApiError && err.code === 'course_code_taken') setErrors({ code: msg });
      else setErrors({ form: msg });
    }
  };

  return (
    <Dialog open onClose={onClose} title={course ? `Edit ${course.code}` : 'New course'}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
          <TextField label="Code" value={form.code} onChange={set('code')} error={errors.code} placeholder="CSC401" maxLength={12} />
          <TextField label="Title" value={form.title} onChange={set('title')} error={errors.title} placeholder="Software Engineering" />
        </div>
        <SelectField label="Department" value={form.department_id} onChange={set('department_id')} error={errors.department_id}
          placeholder="Choose a department"
          options={(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))} />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Credits" value={form.credits} onChange={set('credits')}
            options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} credit${n > 1 ? 's' : ''}` }))} />
          <SelectField label="Semester" value={form.semester} onChange={set('semester')}
            options={[1, 2, 3].map((n) => ({ value: String(n), label: `Semester ${n}` }))} />
        </div>
        {errors.form && <p role="alert" className="text-sm text-red-600">{errors.form}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{course ? 'Save' : 'Create course'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
