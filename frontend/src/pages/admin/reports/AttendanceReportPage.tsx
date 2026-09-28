/** Admin: attendance across all courses - filter by department, course and dates (spec 11.3). */
import { useState } from 'react';
import { PageHeader } from '@/components/DataStates';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useCourses } from '@/features/academics/api';
import { ReportTable } from '@/features/attendance/ReportTable';
import { useDepartments } from '@/features/users/api';

export default function AttendanceReportPage() {
  const departments = useDepartments();
  const [departmentId, setDepartmentId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const courses = useCourses(departmentId);
  const badRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Attendance report" description="Students below the threshold are highlighted in red." />
      <div className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          label="Department"
          value={departmentId}
          placeholder="All departments"
          onChange={(e) => {
            setDepartmentId(e.target.value);
            setCourseId('');
          }}
          options={(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))}
        />
        <SelectField
          label="Course"
          value={courseId}
          placeholder="All courses"
          onChange={(e) => setCourseId(e.target.value)}
          options={(courses.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.title}` }))}
        />
        <TextField label="From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <TextField label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          error={badRange ? 'The end date is before the start date.' : null} />
      </div>
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {badRange ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Fix the date range to see the report.</p>
        ) : (
          <ReportTable
            filters={{
              department_id: departmentId || undefined,
              course_id: courseId || undefined,
              date_from: dateFrom || undefined,
              date_to: dateTo || undefined,
            }}
            emptyMessage="No attendance sessions match these filters yet."
          />
        )}
      </div>
    </div>
  );
}
