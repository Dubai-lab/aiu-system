import { PageHeader } from '@/components/DataStates';
import { MyCoursesGrid } from '../shared/MyCoursesGrid';

export default function StudentCoursesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="My Courses" description="Courses you are enrolled in this semester." />
      <MyCoursesGrid emptyMessage="You are not enrolled in any course yet. The administrator enrolls students in courses." />
    </div>
  );
}
