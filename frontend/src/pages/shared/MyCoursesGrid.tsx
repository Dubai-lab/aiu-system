/** Course cards for "My courses" (teachers and students). */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Users } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '@/components/DataStates';
import { useMyCourses } from '@/features/academics/api';
import type { MyCourse } from '@/lib/types';

function CourseCard({ course, href }: { course: MyCourse; href?: string }) {
  const body: ReactNode = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-md bg-brand-50 px-2 py-1 font-mono text-sm font-semibold text-brand-700">{course.code}</span>
        <BookOpen className="size-5 text-slate-300" aria-hidden />
      </div>
      <h2 className="mt-3 font-semibold text-slate-900">{course.title}</h2>
      <p className="mt-1 text-sm text-slate-500">{course.department.name} · {course.credits} credits · Semester {course.semester}</p>
      <p className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
        {course.role === 'teacher' ? (
          <><Users className="size-4" aria-hidden /> {course.enrolled_count} student{course.enrolled_count === 1 ? '' : 's'} enrolled</>
        ) : (
          <>Teacher: {course.teacher?.full_name ?? 'Not assigned yet'}</>
        )}
      </p>
    </>
  );
  const cls = 'block rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200';
  return href ? <Link to={href} className={`${cls} transition hover:ring-brand-500`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function MyCoursesGrid({ linkTo, emptyMessage }: { linkTo?: (c: MyCourse) => string; emptyMessage: string }) {
  const courses = useMyCourses();
  if (courses.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
      </div>
    );
  }
  if (courses.isError) return <div className="rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={courses.error} onRetry={() => courses.refetch()} /></div>;
  if (courses.data.length === 0) return <div className="rounded-xl bg-white ring-1 ring-slate-200"><EmptyState title="No courses yet" message={emptyMessage} /></div>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {courses.data.map((c) => <CourseCard key={c.id} course={c} href={linkTo?.(c)} />)}
    </div>
  );
}
