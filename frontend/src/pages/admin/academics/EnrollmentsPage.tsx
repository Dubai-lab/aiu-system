/** Admin: enroll students in a course (choose course, multi-select students). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckSquare, Search, Square, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/SelectField';
import { useCourse, useCourses, useEnrollStudents, useStudentPicker } from '@/features/academics/api';
import { useDepartments } from '@/features/users/api';
import { ApiError } from '@/lib/api';

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function EnrollmentsPage() {
  const [params, setParams] = useSearchParams();
  const courseId = params.get('course') ?? '';
  const courses = useCourses();
  const course = useCourse(courseId, Boolean(courseId));
  const departments = useDepartments();
  const [searchInput, setSearchInput] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [level, setLevel] = useState('');
  const search = useDebounced(searchInput);
  const students = useStudentPicker(search, departmentId, level);
  const enroll = useEnrollStudents(courseId);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // When a course is chosen: clear the selection and default the department filter
  // to the course's department - once per course, so later refreshes keep the admin's choice.
  const initialisedFor = useRef('');
  useEffect(() => {
    if (course.data && initialisedFor.current !== course.data.id) {
      initialisedFor.current = course.data.id;
      setSelected(new Set());
      setDepartmentId(course.data.department.id);
    }
  }, [course.data]);

  const enrolledIds = useMemo(() => new Set((course.data?.students ?? []).map((s) => s.id)), [course.data]);
  const candidates = students.data?.items ?? [];
  const selectable = candidates.filter((s) => !enrolledIds.has(s.id));
  const allSelected = selectable.length > 0 && selectable.every((s) => selected.has(s.id));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((s) => s.id)));

  const submit = async () => {
    try {
      const r = await enroll.mutateAsync([...selected]);
      toast.success(`${r.added} student(s) enrolled in ${r.course.code}.${r.already_enrolled ? ` ${r.already_enrolled} were already enrolled.` : ''}`);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Enrollment failed.');
    }
  };

  const activeCourses = (courses.data ?? []).filter((c) => c.is_active);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Enrollments" description="Choose a course, then tick the students to enroll." />

      <Card>
        <SelectField
          label="Course"
          value={courseId}
          onChange={(e) => setParams(e.target.value ? { course: e.target.value } : {}, { replace: true })}
          placeholder={courses.isPending ? 'Loading courses…' : 'Choose a course'}
          options={activeCourses.map((c) => ({ value: c.id, label: `${c.code} · ${c.title} (${c.enrolled_count} enrolled)` }))}
        />
        {course.data && (
          <p className="mt-3 text-sm text-slate-600">
            Teacher: {course.data.teacher?.full_name ?? <Badge tone="amber">No teacher</Badge>} ·{' '}
            <Link to={`/admin/courses/${course.data.id}`} className="text-brand-700 hover:underline">
              {course.data.enrolled_count} enrolled - view class list
            </Link>
          </p>
        )}
      </Card>

      {courseId && (
        <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_220px_140px]">
            <div className="relative">
              <label htmlFor="student-search" className="sr-only">Search students</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input id="student-search" type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search name, email or reg number"
                className="block w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
            </div>
            <SelectField label="Department" hideLabel value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
              placeholder="All departments" options={(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))} />
            <SelectField label="Level" hideLabel value={level} onChange={(e) => setLevel(e.target.value)}
              placeholder="All levels" options={[100, 200, 300, 400].map((l) => ({ value: String(l), label: `Level ${l}` }))} />
          </div>

          {students.isPending || course.isPending ? (
            <TableSkeleton />
          ) : students.isError ? (
            <ErrorState error={students.error} onRetry={() => students.refetch()} />
          ) : candidates.length === 0 ? (
            <EmptyState title="No students match" message={<>Try other filters, or <Link to="/admin/students/new" className="text-brand-700 hover:underline">register a student</Link>.</>} />
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <button type="button" onClick={toggleAll} disabled={selectable.length === 0}
                  className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 disabled:opacity-40">
                  {allSelected ? <CheckSquare className="size-4 text-brand-700" aria-hidden /> : <Square className="size-4" aria-hidden />}
                  Select all ({selectable.length})
                </button>
                <span className="text-sm text-slate-500">{selected.size} selected</span>
              </div>
              <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
                {candidates.map((s) => {
                  const enrolled = enrolledIds.has(s.id);
                  return (
                    <li key={s.id}>
                      <label className={`flex items-center gap-3 px-4 py-2.5 ${enrolled ? 'cursor-default bg-slate-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                        <input type="checkbox" className="size-4 accent-brand-700" disabled={enrolled}
                          checked={enrolled || selected.has(s.id)} onChange={() => toggle(s.id)} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-900">{s.full_name}</span>
                          <span className="block text-xs text-slate-500"><span className="font-mono">{s.reg_number}</span> · {s.department_code} · Level {s.level}</span>
                        </span>
                        {enrolled && <Badge tone="green">Enrolled</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {(students.data?.total ?? 0) > candidates.length && (
                <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                  Showing the first {candidates.length} of {students.data?.total}. Use the filters to narrow the list.
                </p>
              )}
              <div className="flex justify-end border-t border-slate-200 p-4">
                <Button onClick={submit} disabled={selected.size === 0} loading={enroll.isPending} icon={<UserPlus className="size-4" aria-hidden />}>
                  Enroll {selected.size || ''} student{selected.size === 1 ? '' : 's'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
