/** Admin course page: details, assign teacher, enrolled students, activate/delete. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Power, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState, PageHeader, Skeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { SelectField } from '@/components/ui/SelectField';
import { useActiveTeachers, useAssignTeacher, useCourse, useDeleteCourse, useSaveCourse, useUnenrollStudent } from '@/features/academics/api';
import { ApiError } from '@/lib/api';
import type { PersonRef } from '@/lib/types';
import { CourseFormDialog } from './CourseFormDialog';

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function CourseDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const course = useCourse(id);
  const teachers = useActiveTeachers();
  const assign = useAssignTeacher(id);
  const unenroll = useUnenrollStudent(id);
  const save = useSaveCourse();
  const remove = useDeleteCourse();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<PersonRef | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'toggle' | null>(null);

  if (course.isPending) return <div className="mx-auto max-w-5xl space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-48 w-full" /></div>;
  if (course.isError) return <div className="mx-auto max-w-5xl rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={course.error} onRetry={() => course.refetch()} /></div>;
  const c = course.data;
  const students = c.students ?? [];

  const changeTeacher = async (teacherId: string) => {
    try {
      const updated = await assign.mutateAsync(teacherId || null);
      toast.success(updated.teacher ? `${updated.teacher.full_name} now teaches ${c.code}.` : `${c.code} has no teacher now.`);
    } catch (err) {
      toast.error(message(err, 'Could not assign the teacher.'));
    }
  };

  const doUnenroll = async () => {
    if (!removing) return;
    try {
      await unenroll.mutateAsync(removing.id);
      toast.success(`${removing.full_name} removed from ${c.code}.`);
    } catch (err) {
      toast.error(message(err, 'Could not remove the student.'));
    }
    setRemoving(null);
  };

  const doConfirm = async () => {
    try {
      if (confirm === 'delete') {
        await remove.mutateAsync(c.id);
        toast.success(`${c.code} deleted.`);
        navigate('/admin/courses');
        return;
      }
      await save.mutateAsync({ id: c.id, is_active: !c.is_active });
      toast.success(c.is_active ? `${c.code} deactivated.` : `${c.code} reactivated.`);
    } catch (err) {
      toast.error(message(err, 'The action failed.'));
    }
    setConfirm(null);
  };

  // Keep the current teacher in the list even if they are not in the active list any more.
  const teacherOptions = (teachers.data ?? []).map((t) => ({ value: t.id, label: t.staff_title ? `${t.full_name} (${t.staff_title})` : t.full_name }));
  if (c.teacher && !teacherOptions.some((o) => o.value === c.teacher!.id)) teacherOptions.unshift({ value: c.teacher.id, label: c.teacher.full_name });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to="/admin/courses" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Back to courses
      </Link>
      <PageHeader
        title={`${c.code} · ${c.title}`}
        description={`${c.department.name} · ${c.credits} credits · Semester ${c.semester}`}
        actions={
          <>
            <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="secondary" icon={<Power className="size-4" aria-hidden />} onClick={() => setConfirm('toggle')}>
              {c.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
            <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirm('delete')}>Delete</Button>
          </>
        }
      />
      {!c.is_active && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This course is deactivated: it is hidden from teachers and students and no one can be enrolled.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Teacher" description="One teacher runs this course and its attendance." className="lg:col-span-1">
          <SelectField
            label="Assigned teacher"
            value={c.teacher?.id ?? ''}
            onChange={(e) => void changeTeacher(e.target.value)}
            disabled={assign.isPending || teachers.isPending}
            placeholder="No teacher assigned"
            options={teacherOptions}
          />
          {teachers.isSuccess && teachers.data.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">
              No active teachers yet. <Link to="/admin/teachers/new" className="text-brand-700 hover:underline">Register a teacher</Link>.
            </p>
          )}
        </Card>

        <Card
          title={`Enrolled students (${students.length})`}
          className="lg:col-span-2"
          actions={
            c.is_active && (
              <Link to={`/admin/enrollments?course=${c.id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                <UserPlus className="size-4" aria-hidden /> Enroll students
              </Link>
            )
          }
        >
          {students.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No students enrolled yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {students.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link to={`/admin/users/${s.id}`} className="font-medium text-slate-900 hover:underline">{s.full_name}</Link>
                    <p className="text-xs text-slate-500"><span className="font-mono">{s.reg_number}</span> · Level {s.level}</p>
                  </div>
                  {!s.is_active && <Badge tone="red">Deactivated</Badge>}
                  <button type="button" onClick={() => setRemoving(s)} className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-700"
                    aria-label={`Remove ${s.full_name} from ${c.code}`}>
                    <UserMinus className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && <CourseFormDialog course={c} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.full_name ?? ''}?`}
        message={`They will no longer see ${c.code} or be able to mark its attendance. Past attendance records are kept.`}
        confirmLabel="Remove"
        tone="danger"
        loading={unenroll.isPending}
        onConfirm={doUnenroll}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={`Delete ${c.code}?`}
        message={students.length
          ? `${c.code} has ${students.length} enrolled student(s), so it cannot be deleted. Deactivate it instead to keep its history.`
          : 'The course will be permanently deleted.'}
        confirmLabel="Delete"
        tone="danger"
        loading={remove.isPending}
        onConfirm={doConfirm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'toggle'}
        title={c.is_active ? `Deactivate ${c.code}?` : `Reactivate ${c.code}?`}
        message={c.is_active
          ? 'It will be hidden from teachers and students. Enrollments and history are kept.'
          : 'It will be visible again to its teacher and enrolled students.'}
        confirmLabel={c.is_active ? 'Deactivate' : 'Reactivate'}
        loading={save.isPending}
        onConfirm={doConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
