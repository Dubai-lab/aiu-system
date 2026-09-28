/** Admin: email log - every send attempt; failed credential emails link to the user to resend (spec 9). */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { SelectField } from '@/components/ui/SelectField';
import { api } from '@/lib/api';

interface EmailRow {
  id: string;
  to_email: string;
  template: string;
  subject: string;
  status: 'sent' | 'failed';
  error: string | null;
  created_at: string;
  related_user_id: string | null;
  user: { id: string; full_name: string; must_change_password: boolean } | null;
}

const TEMPLATES: Record<string, string> = {
  student_welcome: 'Student welcome',
  teacher_welcome: 'Teacher welcome',
  admin_welcome: 'Admin welcome',
  password_reset_by_admin: 'Password reset',
  password_changed: 'Password changed',
  invoice_created: 'New invoice',
  payment_receipt: 'Payment receipt',
};
const CREDENTIALS = new Set(['student_welcome', 'teacher_welcome', 'admin_welcome', 'password_reset_by_admin']);

export default function EmailLogsPage() {
  const [status, setStatus] = useState('');
  const [template, setTemplate] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setPage(1), [status, template, search]);

  const params = new URLSearchParams({ page: String(page), page_size: '50' });
  if (status) params.set('status', status);
  if (template) params.set('template', template);
  if (search.trim()) params.set('search', search.trim());
  const logs = useQuery({
    queryKey: ['email-logs', params.toString()],
    queryFn: () => api.get<{ items: EmailRow[]; total: number; page: number; page_size: number }>(`/email-logs?${params}`),
    placeholderData: keepPreviousData,
  });
  const data = logs.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Email log" description="Every email the system tried to send. Failed login-detail emails can be resent from the user's page." />
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_200px_160px]">
          <div className="relative">
            <label htmlFor="email-search" className="sr-only">Search by email address</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input id="email-search" type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search by email address"
              className="block w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
          </div>
          <SelectField label="Type" hideLabel value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="All email types"
            options={Object.entries(TEMPLATES).map(([value, label]) => ({ value, label }))} />
          <SelectField label="Status" hideLabel value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Sent and failed"
            options={[{ value: 'sent', label: 'Sent' }, { value: 'failed', label: 'Failed' }]} />
        </div>
        {logs.isPending ? (
          <TableSkeleton rows={8} />
        ) : logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No emails match" message={status || template || search ? 'Try other filters.' : 'Emails appear here as the system sends them.'} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">When</th>
                    <th scope="col" className="px-4 py-3 font-medium">To</th>
                    <th scope="col" className="px-4 py-3 font-medium">Type</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-slate-100 ${logs.isPlaceholderData ? 'opacity-60' : ''}`}>
                  {data.items.map((e) => (
                    <tr key={e.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{new Date(e.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className="px-4 py-3">
                        <span className="block font-medium text-slate-900">{e.to_email}</span>
                        {e.user && <span className="block text-xs text-slate-500">{e.user.full_name}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{TEMPLATES[e.template] ?? e.template}</td>
                      <td className="px-4 py-3">
                        {e.status === 'sent' ? <Badge tone="green">Sent</Badge> : <Badge tone="red">Failed</Badge>}
                        {e.error && <span className="mt-1 block max-w-xs text-xs text-red-700">{e.error}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {e.status === 'failed' && e.user && CREDENTIALS.has(e.template) && (
                          <Link to={`/admin/users/${e.user.id}`} className="text-sm font-medium text-brand-700 hover:underline">Resend</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600" aria-label="Pagination">
              <span>Showing {(data.page - 1) * data.page_size + 1}-{Math.min(data.page * data.page_size, data.total)} of {data.total}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-slate-100 disabled:opacity-40">
                  <ChevronLeft className="size-4" aria-hidden /> Prev
                </button>
                <button type="button" onClick={() => setPage(page + 1)} disabled={page * data.page_size >= data.total}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-slate-100 disabled:opacity-40">
                  Next <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
