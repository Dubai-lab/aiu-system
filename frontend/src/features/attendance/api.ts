/** Attendance hooks. Live screens combine TanStack Query with Supabase Realtime. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { academicKeys } from '@/features/academics/api';
import { api } from '@/lib/api';
import type { AttendanceReport, CourseAttendance, SessionDetail, SessionSummary, StudentSession } from '@/lib/types';
import { useRealtime } from '@/lib/useRealtime';

export const attendanceKeys = {
  all: ['attendance'] as const,
  open: ['attendance', 'open'] as const,
  studentSession: (id: string) => ['attendance', 'student-session', id] as const,
  mine: ['attendance', 'me'] as const,
  sessions: (courseId: string) => ['attendance', 'sessions', courseId] as const,
  session: (id: string) => ['attendance', 'session', id] as const,
  report: (params: string) => ['attendance', 'report', params] as const,
};

// ------------------------------------------------------------------ student
/** Open sessions for the student's courses - updates instantly via Realtime. */
export function useOpenSessions() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: attendanceKeys.open,
    queryFn: () => api.get<StudentSession[]>('/attendance/open'),
    refetchInterval: 30_000, // safety net only - Realtime normally updates this instantly
  });
  // RLS only delivers sessions of courses this student is enrolled in.
  useRealtime({ table: 'attendance_sessions', onChange: () => void qc.invalidateQueries({ queryKey: attendanceKeys.open }) });
  return query;
}

export function useStudentSession(id: string) {
  return useQuery({
    queryKey: attendanceKeys.studentSession(id),
    queryFn: () => api.get<StudentSession>(`/attendance/student-sessions/${id}`),
  });
}

export function useMyAttendance() {
  return useQuery({ queryKey: attendanceKeys.mine, queryFn: () => api.get<CourseAttendance[]>('/attendance/me') });
}

// ------------------------------------------------------------------ teacher
export function useTeacherSessions(courseId = '') {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: attendanceKeys.sessions(courseId),
    queryFn: () => api.get<SessionSummary[]>(`/attendance/sessions${courseId ? `?course_id=${courseId}` : ''}`),
  });
  useRealtime({ table: 'attendance_sessions', onChange: () => void qc.invalidateQueries({ queryKey: ['attendance', 'sessions'] }) });
  return query;
}

/** Live session: refetches whenever a student is marked or the session changes. */
export function useLiveSession(id: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: attendanceKeys.session(id) });
  const query = useQuery({
    queryKey: attendanceKeys.session(id),
    queryFn: () => api.get<SessionDetail>(`/attendance/sessions/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'open' ? 10_000 : false), // safety net while live (Realtime is ~2 s)
  });
  useRealtime({ table: 'attendance_records', filter: `session_id=eq.${id}`, onChange: refresh });
  useRealtime({ table: 'attendance_sessions', filter: `id=eq.${id}`, onChange: refresh });
  return query;
}

/** Show the session the server returned at once, then refresh lists and reports. */
function useSessionResult() {
  const qc = useQueryClient();
  return (s: SessionDetail) => {
    qc.setQueryData(attendanceKeys.session(s.id), s);
    void qc.invalidateQueries({ queryKey: ['attendance', 'sessions'] });
    void qc.invalidateQueries({ queryKey: ['attendance', 'report'] });
    void qc.invalidateQueries({ queryKey: academicKeys.myCourses });
  };
}

export function useCreateSession() {
  const onSession = useSessionResult();
  return useMutation({
    mutationFn: (body: { course_id: string; duration_minutes: number; title?: string | null }) =>
      api.post<SessionDetail>('/attendance/sessions', body),
    onSuccess: onSession,
  });
}

export function useUpdateSession(id: string) {
  const onSession = useSessionResult();
  return useMutation({
    mutationFn: (body: { action: 'extend' | 'regenerate_code' | 'close'; minutes?: number }) =>
      api.patch<SessionDetail>(`/attendance/sessions/${id}`, body),
    onSuccess: onSession,
  });
}

export function useManualMark(id: string) {
  const onSession = useSessionResult();
  return useMutation({
    mutationFn: (body: { student_id: string; reason: string }) =>
      api.post<SessionDetail>(`/attendance/sessions/${id}/manual-mark`, body),
    onSuccess: onSession,
  });
}

// ------------------------------------------------------------------ reports
export interface ReportFilters {
  course_id?: string;
  department_id?: string;
  date_from?: string;
  date_to?: string;
}

export function reportQuery(f: ReportFilters): string {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v) p.set(k, v);
  });
  return p.toString();
}

export function useAttendanceReport(filters: ReportFilters, enabled = true) {
  const qs = reportQuery(filters);
  return useQuery({
    queryKey: attendanceKeys.report(qs),
    queryFn: () => api.get<AttendanceReport>(`/reports/attendance${qs ? `?${qs}` : ''}`),
    enabled,
  });
}
