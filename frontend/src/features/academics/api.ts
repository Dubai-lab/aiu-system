/** TanStack Query hooks for departments, courses, teacher assignment and enrollment. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userKeys } from '@/features/users/api';
import { api } from '@/lib/api';
import type { Course, CourseDetail, DepartmentSummary, MyCourse, Paginated, UserListItem } from '@/lib/types';

export const academicKeys = {
  departments: ['departments'] as const,
  departmentSummary: ['departments', 'summary'] as const,
  courses: ['courses'] as const,
  courseList: (departmentId: string, search: string) => ['courses', 'list', departmentId, search] as const,
  course: (id: string) => ['courses', 'detail', id] as const,
  myCourses: ['my-courses'] as const,
};

/** After any academic change, refresh everything that shows courses, counts or people. */
function useInvalidateAcademics() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: academicKeys.departments });
    void qc.invalidateQueries({ queryKey: academicKeys.courses });
    void qc.invalidateQueries({ queryKey: academicKeys.myCourses });
    void qc.invalidateQueries({ queryKey: userKeys.all }); // user pages list their courses
  };
}

// ------------------------------------------------------------------ departments
export function useDepartmentSummary() {
  return useQuery({ queryKey: academicKeys.departmentSummary, queryFn: () => api.get<DepartmentSummary[]>('/departments/summary') });
}

export function useSaveDepartment() {
  const invalidate = useInvalidateAcademics();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: string; name: string; code: string }) =>
      id ? api.patch<DepartmentSummary>(`/departments/${id}`, body) : api.post<DepartmentSummary>('/departments', body),
    onSuccess: invalidate,
  });
}

export function useDeleteDepartment() {
  const invalidate = useInvalidateAcademics();
  return useMutation({ mutationFn: (id: string) => api.delete<void>(`/departments/${id}`), onSuccess: invalidate });
}

// ------------------------------------------------------------------ courses
export function useCourses(departmentId = '', search = '') {
  const params = new URLSearchParams();
  if (departmentId) params.set('department_id', departmentId);
  if (search.trim()) params.set('search', search.trim());
  return useQuery({
    queryKey: academicKeys.courseList(departmentId, search.trim()),
    queryFn: () => api.get<Course[]>(`/courses${params.size ? `?${params}` : ''}`),
  });
}

export function useCourse(id: string, enabled = true) {
  return useQuery({ queryKey: academicKeys.course(id), queryFn: () => api.get<CourseDetail>(`/courses/${id}`), enabled: enabled && Boolean(id) });
}

export interface CoursePayload {
  code: string;
  title: string;
  department_id: string;
  credits: number;
  semester: number;
  teacher_id?: string | null;
  is_active?: boolean;
}

/** Show the course the server returned straight away, then refresh the rest. */
function useCourseResult() {
  const qc = useQueryClient();
  const invalidate = useInvalidateAcademics();
  return (course: CourseDetail) => {
    qc.setQueryData(academicKeys.course(course.id), course);
    invalidate();
  };
}

export function useSaveCourse() {
  const onCourse = useCourseResult();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CoursePayload> & { id?: string }) =>
      id ? api.patch<CourseDetail>(`/courses/${id}`, body) : api.post<CourseDetail>('/courses', body),
    onSuccess: onCourse,
  });
}

export function useDeleteCourse() {
  const invalidate = useInvalidateAcademics();
  return useMutation({ mutationFn: (id: string) => api.delete<void>(`/courses/${id}`), onSuccess: invalidate });
}

export function useAssignTeacher(courseId: string) {
  const onCourse = useCourseResult();
  return useMutation({
    mutationFn: (teacherId: string | null) => api.post<CourseDetail>(`/courses/${courseId}/teacher`, { teacher_id: teacherId }),
    onSuccess: onCourse,
  });
}

export function useEnrollStudents(courseId: string) {
  const onCourse = useCourseResult();
  return useMutation({
    mutationFn: (studentIds: string[]) =>
      api.post<{ added: number; already_enrolled: number; course: CourseDetail }>(`/courses/${courseId}/enrollments`, { student_ids: studentIds }),
    onSuccess: (result) => onCourse(result.course),
  });
}

export function useUnenrollStudent(courseId: string) {
  const onCourse = useCourseResult();
  return useMutation({
    mutationFn: (studentId: string) => api.delete<CourseDetail>(`/courses/${courseId}/enrollments/${studentId}`),
    onSuccess: onCourse,
  });
}

// ------------------------------------------------------------------ people pickers + own courses
export function useActiveTeachers() {
  return useQuery({
    queryKey: ['users', 'teachers-active'],
    queryFn: () => api.get<Paginated<UserListItem>>('/users?role=teacher&is_active=true&page_size=100'),
    select: (d) => [...d.items].sort((a, b) => a.full_name.localeCompare(b.full_name)),
  });
}

export function useStudentPicker(search: string, departmentId: string, level: string) {
  const params = new URLSearchParams({ role: 'student', is_active: 'true', page_size: '100' });
  if (search.trim()) params.set('search', search.trim());
  if (departmentId) params.set('department_id', departmentId);
  if (level) params.set('level', level);
  return useQuery({
    queryKey: ['users', 'student-picker', search.trim(), departmentId, level],
    queryFn: () => api.get<Paginated<UserListItem>>(`/users?${params}`),
  });
}

export function useMyCourses() {
  return useQuery({ queryKey: academicKeys.myCourses, queryFn: () => api.get<MyCourse[]>('/my/courses') });
}
