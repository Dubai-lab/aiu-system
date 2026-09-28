/** Admin: departments with course / student / teacher counts; create, rename, delete. */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { useDeleteDepartment, useDepartmentSummary, useSaveDepartment } from '@/features/academics/api';
import { ApiError } from '@/lib/api';
import type { DepartmentSummary } from '@/lib/types';

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function DepartmentDialog({ department, onClose }: { department: DepartmentSummary | null; onClose: () => void }) {
  const save = useSaveDepartment();
  const [name, setName] = useState(department?.name ?? '');
  const [code, setCode] = useState(department?.code ?? '');
  const [errors, setErrors] = useState<{ name?: string; code?: string; form?: string }>({});

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (name.trim().length < 2) found.name = 'Enter the department name.';
    if (!/^[A-Za-z]{2,6}$/.test(code.trim())) found.code = 'Use 2-6 letters, e.g. CSC.';
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      await save.mutateAsync({ id: department?.id, name: name.trim(), code: code.trim().toUpperCase() });
      toast.success(department ? 'Department updated.' : 'Department created.');
      onClose();
    } catch (err) {
      const msg = message(err, 'Could not save the department.');
      if (err instanceof ApiError && err.code.includes('code')) setErrors({ code: msg });
      else if (err instanceof ApiError && err.code.includes('name')) setErrors({ name: msg });
      else setErrors({ form: msg });
    }
  };

  return (
    <Dialog open onClose={onClose} title={department ? 'Edit department' : 'New department'}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="e.g. Computer Science" />
        <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} error={errors.code}
          placeholder="e.g. CSC" maxLength={6} hint="2-6 letters. Used in course codes such as CSC401." />
        {errors.form && <p role="alert" className="text-sm text-red-600">{errors.form}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{department ? 'Save' : 'Create'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function DepartmentsPage() {
  const departments = useDepartmentSummary();
  const remove = useDeleteDepartment();
  const [editing, setEditing] = useState<DepartmentSummary | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DepartmentSummary | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(`${deleting.name} deleted.`);
      setDeleting(null);
    } catch (err) {
      toast.error(message(err, 'Could not delete the department.'));
      setDeleting(null);
    }
  };

  const addButton = <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>New department</Button>;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Departments" description="Academic departments. Courses, students and teachers belong to one." actions={addButton} />
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {departments.isPending ? (
          <TableSkeleton rows={3} />
        ) : departments.isError ? (
          <ErrorState error={departments.error} onRetry={() => departments.refetch()} />
        ) : departments.data.length === 0 ? (
          <EmptyState title="No departments yet" message="Create the first department to start adding courses." action={addButton} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Department</th>
                  <th scope="col" className="px-4 py-3 font-medium">Code</th>
                  <th scope="col" className="px-4 py-3 font-medium">Courses</th>
                  <th scope="col" className="px-4 py-3 font-medium">Students</th>
                  <th scope="col" className="px-4 py-3 font-medium">Teachers</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departments.data.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{d.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{d.code}</td>
                    <td className="px-4 py-3">
                      <Link to={`/admin/courses?department=${d.id}`} className="text-brand-700 hover:underline">{d.course_count}</Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{d.student_count}</td>
                    <td className="px-4 py-3 text-slate-700">{d.teacher_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => setEditing(d)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Edit ${d.name}`}>
                          <Pencil className="size-4" aria-hidden />
                        </button>
                        <button type="button" onClick={() => setDeleting(d)} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label={`Delete ${d.name}`}>
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <DepartmentDialog department={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? ''}?`}
        message={
          deleting && (deleting.course_count || deleting.student_count || deleting.teacher_count)
            ? `This department still has ${deleting.course_count} course(s), ${deleting.student_count} student(s) and ${deleting.teacher_count} teacher(s), so it cannot be deleted. Move them to another department first.`
            : 'The department will be permanently deleted.'
        }
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
