/** Admin: all courses with department filter and search; create new courses. */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/SelectField';
import { useCourses } from '@/features/academics/api';
import { useDepartments } from '@/features/users/api';
import { CourseFormDialog } from './CourseFormDialog';

export default function CoursesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const departmentId = params.get('department') ?? '';
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const departments = useDepartments();
  const courses = useCourses(departmentId, search);

  const addButton = <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>New course</Button>;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Courses" description="Courses, their teachers and how many students are enrolled." actions={addButton} />
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_260px]">
          <div className="relative">
            <label htmlFor="course-search" className="sr-only">Search courses</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input id="course-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code or title"
              className="block w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
          </div>
          <SelectField label="Department" hideLabel value={departmentId} placeholder="All departments"
            onChange={(e) => setParams(e.target.value ? { department: e.target.value } : {}, { replace: true })}
            options={(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))} />
        </div>

        {courses.isPending ? (
          <TableSkeleton />
        ) : courses.isError ? (
          <ErrorState error={courses.error} onRetry={() => courses.refetch()} />
        ) : courses.data.length === 0 ? (
          search || departmentId
            ? <EmptyState title="No courses match your filters" message="Try a different search or department." />
            : <EmptyState title="No courses yet" message="Create the first course." action={addButton} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Course</th>
                  <th scope="col" className="px-4 py-3 font-medium">Department</th>
                  <th scope="col" className="px-4 py-3 font-medium">Credits</th>
                  <th scope="col" className="px-4 py-3 font-medium">Semester</th>
                  <th scope="col" className="px-4 py-3 font-medium">Teacher</th>
                  <th scope="col" className="px-4 py-3 font-medium">Students</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {courses.data.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/admin/courses/${c.id}`} className="font-mono font-semibold text-brand-700 hover:underline">{c.code}</Link>
                      <p className="text-slate-700">{c.title}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{c.department.code}</td>
                    <td className="px-4 py-3 text-slate-700">{c.credits}</td>
                    <td className="px-4 py-3 text-slate-700">{c.semester}</td>
                    <td className="px-4 py-3">{c.teacher ? <span className="text-slate-800">{c.teacher.full_name}</span> : <Badge tone="amber">No teacher</Badge>}</td>
                    <td className="px-4 py-3 text-slate-700">{c.enrolled_count}</td>
                    <td className="px-4 py-3">{c.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <CourseFormDialog course={null} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/admin/courses/${c.id}`)} />}
    </div>
  );
}
