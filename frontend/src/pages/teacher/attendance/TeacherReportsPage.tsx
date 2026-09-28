/** Teacher: per-course attendance report with CSV export (spec 11.3). */
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/DataStates';
import { SelectField } from '@/components/ui/SelectField';
import { useMyCourses } from '@/features/academics/api';
import { ReportTable } from '@/features/attendance/ReportTable';

export default function TeacherReportsPage() {
  const [params, setParams] = useSearchParams();
  const courseId = params.get('course') ?? '';
  const courses = useMyCourses();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Attendance reports" description="Each student's attendance percentage across all sessions of your courses." />
      <div className="max-w-md">
        <SelectField
          label="Course"
          value={courseId}
          placeholder="All my courses"
          onChange={(e) => setParams(e.target.value ? { course: e.target.value } : {}, { replace: true })}
          options={(courses.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.title}` }))}
        />
      </div>
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <ReportTable
          filters={{ course_id: courseId || undefined }}
          showCourse={!courseId}
          emptyMessage="Run an attendance session for this course and results appear here."
        />
      </div>
    </div>
  );
}
