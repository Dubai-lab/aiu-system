/** Teacher: one of their courses with the enrolled students. */
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Play } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { useCourse } from '@/features/academics/api';

export default function TeacherCourseDetailPage() {
  const { id = '' } = useParams();
  const course = useCourse(id);

  if (course.isPending) return <div className="mx-auto max-w-5xl space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (course.isError) return <div className="mx-auto max-w-5xl rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={course.error} onRetry={() => course.refetch()} /></div>;
  const c = course.data;
  const students = c.students ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to="/teacher/courses" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Back to my courses
      </Link>
      <PageHeader
        title={`${c.code} · ${c.title}`}
        description={`${c.department.name} · ${c.credits} credits · Semester ${c.semester}`}
        actions={
          <>
            <Link to={`/teacher/reports?course=${c.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50">
              <BarChart3 className="size-4" aria-hidden /> Attendance report
            </Link>
            <Link to={`/teacher/attendance/new?course=${c.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
              <Play className="size-4" aria-hidden /> Start attendance
            </Link>
          </>
        }
      />
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <h2 className="border-b border-slate-200 px-5 py-4 font-semibold text-slate-900">Enrolled students ({students.length})</h2>
        {students.length === 0 ? (
          <EmptyState title="No students enrolled yet" message="The administrator enrolls students in courses." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">#</th>
                  <th scope="col" className="px-5 py-3 font-medium">Name</th>
                  <th scope="col" className="px-5 py-3 font-medium">Reg number</th>
                  <th scope="col" className="px-5 py-3 font-medium">Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((s, i) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {s.full_name} {!s.is_active && <Badge tone="red">Deactivated</Badge>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs whitespace-nowrap text-slate-700">{s.reg_number}</td>
                    <td className="px-5 py-3 text-slate-700">{s.level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
