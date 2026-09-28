/** Attendance report table (teacher + admin), with low-attendance highlighting and CSV export. */
import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ApiError, downloadFile } from '@/lib/api';
import { reportQuery, useAttendanceReport, type ReportFilters } from './api';

export function ReportTable({ filters, showCourse = true, emptyMessage }: {
  filters: ReportFilters;
  showCourse?: boolean;
  emptyMessage: string;
}) {
  const report = useAttendanceReport(filters);
  const [downloading, setDownloading] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);

  const exportCsv = async () => {
    setDownloading(true);
    try {
      const qs = reportQuery(filters);
      const today = new Date().toISOString().slice(0, 10);
      await downloadFile(`/reports/attendance?${qs ? `${qs}&` : ''}format=csv`, `attendance-report-${today}.csv`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

  if (report.isPending) return <TableSkeleton />;
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;
  const { rows, threshold, sessions_count } = report.data;
  const visible = lowOnly ? rows.filter((r) => r.low) : rows;
  const lowCount = rows.filter((r) => r.low).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <p className="text-sm text-slate-600">
          {sessions_count} session{sessions_count === 1 ? '' : 's'} · {rows.length} student record{rows.length === 1 ? '' : 's'} ·{' '}
          <span className={lowCount ? 'font-medium text-red-700' : ''}>{lowCount} below {threshold}%</span>
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="size-4 accent-brand-700" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Only below {threshold}%
          </label>
          <Button variant="secondary" icon={<Download className="size-4" aria-hidden />} loading={downloading} onClick={exportCsv}
            disabled={rows.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          title={rows.length ? 'No students below the threshold' : 'Nothing to report yet'}
          message={rows.length ? undefined : emptyMessage}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {showCourse && <th scope="col" className="px-4 py-3 font-medium">Course</th>}
                <th scope="col" className="px-4 py-3 font-medium">Student</th>
                <th scope="col" className="px-4 py-3 font-medium">Reg number</th>
                <th scope="col" className="px-4 py-3 font-medium">Attended</th>
                <th scope="col" className="px-4 py-3 font-medium">Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r) => (
                <tr key={`${r.course.id}-${r.student.id}`} className={r.low ? 'bg-red-50/60' : ''}>
                  {showCourse && <td className="px-4 py-3 font-mono font-semibold text-brand-700">{r.course.code}</td>}
                  <td className="px-4 py-3 font-medium text-slate-900">{r.student.full_name}</td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-700">{r.student.reg_number}</td>
                  <td className="px-4 py-3 text-slate-700">{r.attended}/{r.total}</td>
                  <td className="px-4 py-3">
                    {r.percent === null ? (
                      <span className="text-slate-400">No sessions yet</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                          <span className={`block h-full ${r.low ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${r.percent}%` }} />
                        </span>
                        <span className={`font-semibold ${r.low ? 'text-red-700' : 'text-slate-900'}`}>{r.percent}%</span>
                        {r.low && <Badge tone="red">Below {threshold}%</Badge>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
