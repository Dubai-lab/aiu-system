import { PageHeader } from '@/components/DataStates';
import { MyCoursesGrid } from '../shared/MyCoursesGrid';

export default function TeacherCoursesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="My Courses" description="Courses you teach. Open one to see the enrolled students." />
      <MyCoursesGrid linkTo={(c) => `/teacher/courses/${c.id}`}
        emptyMessage="You are not assigned to any course yet. The administrator assigns teachers to courses." />
    </div>
  );
}
