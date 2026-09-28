/** Admin list of students / teachers / administrators with search, filters and paging. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, UserPlus } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { SelectField } from '@/components/ui/SelectField';
import { useDepartments, useUsers, type UserFilters } from '@/features/users/api';
import type { Role } from '@/lib/types';
import { formatDate, ROLE_CONFIG } from './roleConfig';

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function UserListPage({ role }: { role: Role }) {
  const cfg = ROLE_CONFIG[role];
  const [searchInput, setSearchInput] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState<UserFilters['status']>('');
  const [page, setPage] = useState(1);
  const search = useDebounced(searchInput);

  // Any filter change goes back to page 1.
  useEffect(() => setPage(1), [search, departmentId, status]);

  const departments = useDepartments();
  const users = useUsers({ role, search, department_id: departmentId, status, page });
  const data = users.data;
  const isStudent = role === 'student';
  const filtering = Boolean(search || departmentId || status);

  const registerButton = (
    <Link
      to={cfg.newPath}
      className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800"
    >
      <UserPlus className="size-4" aria-hidden /> Register {cfg.singular}
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={cfg.title} description={cfg.description} actions={registerButton} />

      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_200px_160px]">
          <div className="relative">
            <label htmlFor="user-search" className="sr-only">Search</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              id="user-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={isStudent ? 'Search name, email or reg number' : 'Search name or email'}
              className="block w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <SelectField
            label="Department"
            hideLabel
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            placeholder="All departments"
            options={(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))}
          />
          <SelectField
            label="Status"
            hideLabel
            value={status}
            onChange={(e) => setStatus(e.target.value as UserFilters['status'])}
            placeholder="All statuses"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Deactivated' },
            ]}
          />
        </div>

        {users.isPending ? (
          <TableSkeleton />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => users.refetch()} />
        ) : !data || data.items.length === 0 ? (
          filtering ? (
            <EmptyState title={`No ${cfg.title.toLowerCase()} match your filters`} message="Try a different search or clear the filters." />
          ) : (
            <EmptyState title={`No ${cfg.title.toLowerCase()} yet`} message={`Register the first ${cfg.singular} to get started.`} action={registerButton} />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Name</th>
                    <th scope="col" className="px-4 py-3 font-medium">{isStudent ? 'Reg number' : 'Title'}</th>
                    <th scope="col" className="px-4 py-3 font-medium">Department</th>
                    {isStudent && <th scope="col" className="px-4 py-3 font-medium">Level</th>}
                    <th scope="col" className="px-4 py-3 font-medium">Face ID</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Registered</th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-slate-100 ${users.isPlaceholderData ? 'opacity-60' : ''}`}>
                  {data.items.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link to={`/admin/users/${u.id}`} className="font-medium text-brand-700 hover:underline">
                          {u.full_name}
                        </Link>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-700">{isStudent ? u.reg_number : (u.staff_title ?? '-')}</td>
                      <td className="px-4 py-3 text-slate-700">{u.department_code ?? '-'}</td>
                      {isStudent && <td className="px-4 py-3 text-slate-700">{u.level}</td>}
                      <td className="px-4 py-3">
                        {u.face_enrolled ? <Badge tone="green">Enrolled</Badge> : <Badge tone="slate">Not enrolled</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}
                          {u.must_change_password && <Badge tone="amber">Default password</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">{formatDate(u.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600" aria-label="Pagination">
      <span>
        Showing {first}-{last} of {total}
      </span>
      <div className="flex gap-2">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-slate-100 disabled:opacity-40" aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden /> Prev
        </button>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-slate-100 disabled:opacity-40" aria-label="Next page">
          Next <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
