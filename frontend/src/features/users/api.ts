/** TanStack Query hooks for admin user management. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Department, Paginated, Role, UserDetail, UserListItem } from '@/lib/types';

export interface UserFilters {
  role: Role;
  search: string;
  department_id: string;
  status: '' | 'active' | 'inactive';
  page: number;
}

export const userKeys = {
  all: ['users'] as const,
  list: (f: UserFilters) => ['users', 'list', f] as const,
  detail: (id: string) => ['users', 'detail', id] as const,
};

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<Department[]>('/departments'),
    staleTime: 5 * 60_000,
  });
}

export function useUsers(filters: UserFilters) {
  const params = new URLSearchParams({ role: filters.role, page: String(filters.page), page_size: '20' });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.department_id) params.set('department_id', filters.department_id);
  if (filters.status) params.set('is_active', String(filters.status === 'active'));
  return useQuery({
    queryKey: userKeys.list(filters),
    queryFn: () => api.get<Paginated<UserListItem>>(`/users?${params}`),
    placeholderData: keepPreviousData, // keep the table visible while the next page loads
  });
}

/**
 * `awaitEmail`: right after registering/resetting, the credentials email is still
 * being sent in the background - poll every 2 s (up to ~30 s) until its result
 * is logged, so a failure shows the Resend warning without a manual reload.
 */
export function useUser(id: string, awaitEmailSince?: number) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => api.get<UserDetail>(`/users/${id}`),
    refetchInterval: (query) => {
      if (!awaitEmailSince || Date.now() - awaitEmailSince > 30_000) return false;
      const sent = query.state.data?.credentials_email?.created_at;
      return sent && new Date(sent).getTime() >= awaitEmailSince - 5_000 ? false : 2000;
    },
  });
}

export interface RegisterPayload {
  full_name: string;
  email: string;
  phone?: string | null;
  department_id?: string | null;
  level?: number;
  intake_year?: number;
  staff_title?: string | null;
}

const REGISTER_PATH: Record<Role, string> = { student: '/users/students', teacher: '/users/teachers', admin: '/users/admins' };

/** Every mutation refreshes the user lists and the affected user's detail. */
function useUserMutation<TVars>(fn: (vars: TVars) => Promise<UserDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (user) => {
      qc.setQueryData(userKeys.detail(user.id), user);
      void qc.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}

export function useRegisterUser(role: Role) {
  return useUserMutation((body: RegisterPayload) => api.post<UserDetail>(REGISTER_PATH[role], body));
}

export function useUpdateUser(id: string) {
  return useUserMutation((body: Partial<RegisterPayload> & { is_active?: boolean }) => api.patch<UserDetail>(`/users/${id}`, body));
}

export function useResetPassword(id: string) {
  return useUserMutation(() => api.post<UserDetail>(`/users/${id}/reset-password`));
}

export function useResendCredentials(id: string) {
  return useUserMutation(() => api.post<UserDetail>(`/users/${id}/resend-credentials`));
}
