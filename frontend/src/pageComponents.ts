/**
 * pages.json key -> React component. The router is built from this map, and a
 * unit test checks that every pages.json entry has a component here and vice
 * versa, so the assistant can never navigate to a page that does not exist.
 *
 * Pages are lazy-loaded: each one is a separate chunk, downloaded the first time
 * it is opened, so the login page loads fast. (AppShell wraps them in Suspense.)
 */
import { lazy, type ComponentType } from 'react';

// One lazy component per module, so pages sharing a module share the chunk and the wrapper.
const cache = new Map<string, ComponentType>();
function page(id: string, load: () => Promise<{ default: ComponentType }>): ComponentType {
  if (!cache.has(id)) cache.set(id, lazy(load));
  return cache.get(id)!;
}

export const PAGE_COMPONENTS: Record<string, ComponentType> = {
  'admin.dashboard': page('AdminDashboard', () => import('@/pages/admin/AdminDashboard')),
  'admin.students': page('StudentsPage', () => import('@/pages/admin/users').then((m) => ({ default: m.StudentsPage }))),
  'admin.students.new': page('RegisterStudentPage', () => import('@/pages/admin/users').then((m) => ({ default: m.RegisterStudentPage }))),
  'admin.teachers': page('TeachersPage', () => import('@/pages/admin/users').then((m) => ({ default: m.TeachersPage }))),
  'admin.teachers.new': page('RegisterTeacherPage', () => import('@/pages/admin/users').then((m) => ({ default: m.RegisterTeacherPage }))),
  'admin.admins': page('AdminsPage', () => import('@/pages/admin/users').then((m) => ({ default: m.AdminsPage }))),
  'admin.admins.new': page('RegisterAdminPage', () => import('@/pages/admin/users').then((m) => ({ default: m.RegisterAdminPage }))),
  'admin.users.detail': page('UserDetailPage', () => import('@/pages/admin/users').then((m) => ({ default: m.UserDetailPage }))),
  'admin.users.face_enrollment': page('FaceEnrollmentPage', () => import('@/pages/admin/users').then((m) => ({ default: m.FaceEnrollmentPage }))),
  'admin.departments': page('DepartmentsPage', () => import('@/pages/admin/academics/DepartmentsPage')),
  'admin.courses': page('CoursesPage', () => import('@/pages/admin/academics/CoursesPage')),
  'admin.courses.detail': page('CourseDetailPage', () => import('@/pages/admin/academics/CourseDetailPage')),
  'admin.enrollments': page('EnrollmentsPage', () => import('@/pages/admin/academics/EnrollmentsPage')),
  'admin.fees': page('FeesPage', () => import('@/pages/admin/finance/FeesPage')),
  'admin.invoices': page('AdminInvoicesPage', () => import('@/pages/admin/finance/AdminInvoicesPage')),
  'admin.receipt': page('ReceiptPage', () => import('@/pages/shared/ReceiptPage')),
  'admin.reports.attendance': page('AttendanceReportPage', () => import('@/pages/admin/reports/AttendanceReportPage')),
  'admin.audit_logs': page('AuditLogsPage', () => import('@/pages/admin/logs/AuditLogsPage')),
  'admin.email_logs': page('EmailLogsPage', () => import('@/pages/admin/logs/EmailLogsPage')),
  'admin.profile': page('ProfilePage', () => import('@/pages/shared/ProfilePage')),
  'teacher.dashboard': page('TeacherDashboard', () => import('@/pages/teacher/TeacherDashboard')),
  'teacher.courses': page('TeacherCoursesPage', () => import('@/pages/teacher/TeacherCoursesPage')),
  'teacher.courses.detail': page('TeacherCourseDetailPage', () => import('@/pages/teacher/TeacherCourseDetailPage')),
  'teacher.attendance': page('TeacherAttendancePage', () => import('@/pages/teacher/attendance/TeacherAttendancePage')),
  'teacher.attendance.new': page('NewSessionPage', () => import('@/pages/teacher/attendance/NewSessionPage')),
  'teacher.attendance.session': page('LiveSessionPage', () => import('@/pages/teacher/attendance/LiveSessionPage')),
  'teacher.reports': page('TeacherReportsPage', () => import('@/pages/teacher/attendance/TeacherReportsPage')),
  'teacher.profile': page('ProfilePage', () => import('@/pages/shared/ProfilePage')),
  'student.dashboard': page('StudentDashboard', () => import('@/pages/student/StudentDashboard')),
  'student.courses': page('StudentCoursesPage', () => import('@/pages/student/StudentCoursesPage')),
  'student.attendance': page('StudentAttendancePage', () => import('@/pages/student/StudentAttendancePage')),
  'student.attendance.mark': page('MarkAttendancePage', () => import('@/pages/student/MarkAttendancePage')),
  'student.invoices': page('StudentInvoicesPage', () => import('@/pages/student/finance/StudentInvoicesPage')),
  'student.invoices.new': page('NewInvoicePage', () => import('@/pages/student/finance/NewInvoicePage')),
  'student.invoices.pay': page('CheckoutPage', () => import('@/pages/student/finance/CheckoutPage')),
  'student.receipt': page('ReceiptPage', () => import('@/pages/shared/ReceiptPage')),
  'student.profile': page('ProfilePage', () => import('@/pages/shared/ProfilePage')),
};
