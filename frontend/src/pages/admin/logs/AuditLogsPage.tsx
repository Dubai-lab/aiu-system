/** Admin: filterable audit log - actor, action, via ui/voice, date (spec 14.1).
 *  Demo step 9: show which actions were done by voice vs by clicking. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Mic, MousePointerClick, Search, Server } from 'lucide-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { api } from '@/lib/api';

interface AuditRow {
  id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  via: 'ui' | 'voice' | 'system';
  ip: string | null;
  created_at: string;
  actor: { id: string; full_name: string; role: string } | null;
}

interface AuditResponse {
  items: AuditRow[];
  total: number;
  page: number;
  page_size: number;
  counts_by_via: { ui: number; voice: number; system: number };
}

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const VIA = {
  voice: { label: 'Voice', Icon: Mic, cls: 'bg-purple-100 text-purple-800' },
  ui: { label: 'Click', Icon: MousePointerClick, cls: 'bg-slate-100 text-slate-700' },
  system: { label: 'System', Icon: Server, cls: 'bg-amber-100 text-amber-800' },
} as const;

/** "attendance.session_create" -> "Attendance · session create" */
const humanAction = (a: string) => {
  const [area, ...rest] = a.split('.');
  return `${area.charAt(0).toUpperCase()}${area.slice(1)} · ${rest.join(' ').replace(/_/g, ' ')}`;
};

/** A short, readable summary of the most useful detail fields (never secrets - none are logged). */
function detailSummary(d: Record<string, unknown>): string {
  const keys = ['invoice_number', 'reference', 'course', 'code', 'email', 'reg_number', 'fee', 'amount', 'name', 'reason', 'method', 'reason', 'similarity', 'top1', 'turn_yaw'];
  const parts: string[] = [];
  for (const k of keys) {
    const v = d[k];
    if (v !== undefined && v !== null && v !== '' && !parts.some((p) => p.startsWith(`${k}:`))) parts.push(`${k.replace(/_/g, ' ')}: ${String(v)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

export default function AuditLogsPage() {
  const [actionInput, setActionInput] = useState('');
  const action = useDebounced(actionInput);
  const [via, setVia] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [action, via, from, to]);

  const params = new URLSearchParams({ page: String(page), page_size: '50' });
  if (action.trim()) params.set('action', action.trim());
  if (via) params.set('via', via);
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  const logs = useQuery({
    queryKey: ['audit-logs', params.toString()],
    queryFn: () => api.get<AuditResponse>(`/audit-logs?${params}`),
    placeholderData: keepPreviousData,
  });
  const data = logs.data;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Audit log" description="Every change, login and assistant action - and whether it was done by voice or by clicking." />

      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          {(['voice', 'ui', 'system'] as const).map((v) => {
            const { label, Icon, cls } = VIA[v];
            return (
              <button key={v} type="button" onClick={() => setVia(via === v ? '' : v)} aria-pressed={via === v}
                className={`flex items-center gap-3 rounded-xl bg-white p-4 text-left shadow-sm ring-1 transition ${via === v ? 'ring-2 ring-brand-500' : 'ring-slate-200 hover:ring-slate-300'}`}>
                <span className={`flex size-10 items-center justify-center rounded-lg ${cls}`}><Icon className="size-5" aria-hidden /></span>
                <span>
                  <span className="block text-2xl font-semibold text-slate-900">{data.counts_by_via[v]}</span>
                  <span className="block text-sm text-slate-500">{label} actions</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_160px_160px_160px]">
          <div className="relative">
            <label htmlFor="audit-action" className="mb-1.5 block text-sm font-medium text-slate-700">Action</label>
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-slate-400" aria-hidden />
            <input id="audit-action" type="search" value={actionInput} onChange={(e) => setActionInput(e.target.value)} placeholder="e.g. invoice, login, face"
              className="block w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
          </div>
          <SelectField label="Done by" value={via} onChange={(e) => setVia(e.target.value)} placeholder="Voice, click or system"
            options={[{ value: 'voice', label: 'Voice' }, { value: 'ui', label: 'Click' }, { value: 'system', label: 'System' }]} />
          <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        {logs.isPending ? (
          <TableSkeleton rows={8} />
        ) : logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No matching entries" message="Try a different action, date range or 'done by' filter." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">When</th>
                    <th scope="col" className="px-4 py-3 font-medium">Who</th>
                    <th scope="col" className="px-4 py-3 font-medium">Action</th>
                    <th scope="col" className="px-4 py-3 font-medium">Details</th>
                    <th scope="col" className="px-4 py-3 font-medium">Done by</th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-slate-100 ${logs.isPlaceholderData ? 'opacity-60' : ''}`}>
                  {data.items.map((row) => {
                    const { label, Icon, cls } = VIA[row.via];
                    return (
                      <tr key={row.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                          {new Date(row.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })}
                        </td>
                        <td className="px-4 py-3">
                          {row.actor ? (
                            <Link to={`/admin/users/${row.actor.id}`} className="font-medium text-slate-900 hover:underline">{row.actor.full_name}</Link>
                          ) : <span className="text-slate-500">{row.via === 'system' ? 'System' : 'Unknown'}</span>}
                          {row.actor && <span className="block text-xs capitalize text-slate-500">{row.actor.role}</span>}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800">{humanAction(row.action)}</td>
                        <td className="max-w-xs px-4 py-3 text-xs text-slate-600">{detailSummary(row.details) || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
                            <Icon className="size-3.5" aria-hidden /> {label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
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
