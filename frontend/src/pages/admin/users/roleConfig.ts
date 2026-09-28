import type { Role } from '@/lib/types';

export interface RoleConfig {
  title: string;       // list page title
  singular: string;    // "student"
  listPath: string;
  newPath: string;
  description: string;
}

export const ROLE_CONFIG: Record<Role, RoleConfig> = {
  student: {
    title: 'Students',
    singular: 'student',
    listPath: '/admin/students',
    newPath: '/admin/students/new',
    description: 'Registered students, their registration numbers and account status.',
  },
  teacher: {
    title: 'Teachers',
    singular: 'teacher',
    listPath: '/admin/teachers',
    newPath: '/admin/teachers/new',
    description: 'Lecturers who run courses and attendance sessions.',
  },
  admin: {
    title: 'Administrators',
    singular: 'administrator',
    listPath: '/admin/admins',
    newPath: '/admin/admins/new',
    description: 'Deans, HODs and administrative officers with full access.',
  },
};

export const LEVELS = [100, 200, 300, 400] as const;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
