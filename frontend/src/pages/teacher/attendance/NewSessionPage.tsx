/** Teacher: start an attendance session (spec 11.1). */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Play } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/DataStates';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useMyCourses } from '@/features/academics/api';
import { useCreateSession } from '@/features/attendance/api';
import { api, ApiError } from '@/lib/api';
import type { SessionSummary } from '@/lib/types';

const DURATIONS = [5, 10, 15, 20, 30, 45, 60];

export default function NewSessionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const courses = useMyCourses();
  const create = useCreateSession();
  const [courseId, setCourseId] = useState(params.get('course') ?? '');
  const [duration, setDuration] = useState('15');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  // One course only? Choose it automatically.
  useEffect(() => {
    if (!courseId && courses.data?.length === 1) setCourseId(courses.data[0].id);
  }, [courses.data, courseId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!courseId) {
      setError('Choose a course.');
      return;
    }
    setError(null);
    try {
      const s = await create.mutateAsync({ course_id: courseId, duration_minutes: Number(duration), title: title.trim() || null });
      toast.success(`Attendance started for ${s.course.code}.`);
      navigate(`/teacher/attendance/${s.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'session_already_open') {
        // Take the teacher straight to the session that is already running.
        const open = (await api.get<SessionSummary[]>(`/attendance/sessions?course_id=${courseId}`)).find((s) => s.status === 'open');
        toast.info(err.message);
        if (open) navigate(`/teacher/attendance/${open.id}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not start the session.');
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link to="/teacher/attendance" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Back to attendance
      </Link>
      <PageHeader title="Start attendance" description="A 6-digit class code is created for you to show in class." />
      <Card>
        {courses.isSuccess && courses.data.length === 0 ? (
          <p className="text-sm text-slate-600">You are not assigned to any course yet. The administrator assigns teachers to courses.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <SelectField label="Course" value={courseId} onChange={(e) => setCourseId(e.target.value)} error={error === 'Choose a course.' ? error : null}
              placeholder={courses.isPending ? 'Loading…' : 'Choose a course'}
              options={(courses.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.title} (${c.enrolled_count} students)` }))} />
            <SelectField label="Open for" value={duration} onChange={(e) => setDuration(e.target.value)}
              options={DURATIONS.map((d) => ({ value: String(d), label: `${d} minutes` }))} />
            <TextField label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
              placeholder={`Lecture - ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`} />
            {error && error !== 'Choose a course.' && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <Button type="submit" loading={create.isPending} icon={<Play className="size-4" aria-hidden />} className="w-full">
              Start attendance
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
