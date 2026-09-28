/** Admin: all invoices - filters, create for a student, cancel with a reason (spec 12.2). */
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FilePlus2, Receipt, Search, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useStudentPicker } from '@/features/academics/api';
import { useCancelInvoice, useCreateInvoice, useFees, useInvoices, type InvoiceFilters } from '@/features/finance/api';
import { InvoiceStatusBadge } from '@/features/finance/components';
import { formatDay, formatMoney } from '@/features/finance/format';
import { ApiError } from '@/lib/api';
import type { Invoice } from '@/lib/types';

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function CreateForStudentDialog({ onClose }: { onClose: () => void }) {
  const fees = useFees();
  const create = useCreateInvoice();
  const [search, setSearch] = useState('');
  const students = useStudentPicker(useDebounced(search), '', '');
  const [studentId, setStudentId] = useState('');
  const [feeId, setFeeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!studentId || !feeId) return setError('Choose a student and a fee.');
    try {
      const r = await create.mutateAsync({ student_id: studentId, fee_type_id: feeId });
      if (r.created) toast.success(r.message);
      else toast.info(r.message);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invoice.');
    }
  };

  return (
    <Dialog open onClose={onClose} title="Create invoice for a student">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField label="Find student" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or registration number" />
        <SelectField label="Student" value={studentId} onChange={(e) => setStudentId(e.target.value)}
          placeholder={students.isPending ? 'Loading…' : `Choose a student (${students.data?.items.length ?? 0} found)`}
          options={(students.data?.items ?? []).map((s) => ({ value: s.id, label: `${s.full_name} (${s.reg_number})` }))} />
        <SelectField label="Fee" value={feeId} onChange={(e) => setFeeId(e.target.value)} placeholder="Choose a fee"
          options={(fees.data ?? []).map((f) => ({ value: f.id, label: `${f.name} - ${formatMoney(f.amount, f.currency)}` }))} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button type="submit" loading={create.isPending}>Create invoice</Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const cancel = useCancelInvoice();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) return setError('A reason is required.');
    try {
      await cancel.mutateAsync({ id: invoice.id, reason: reason.trim() });
      toast.success(`Invoice ${invoice.invoice_number} cancelled.`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel the invoice.');
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Cancel ${invoice.invoice_number}?`}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <p>{invoice.student.full_name} - {invoice.fee_type.name}, {formatMoney(invoice.amount, invoice.currency)}. The student will no longer be able to pay it.</p>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. created in error" maxLength={300} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>Keep invoice</Button>
          <Button type="submit" variant="danger" loading={cancel.isPending}>Cancel invoice</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function AdminInvoicesPage() {
  const fees = useFees(true);
  const [status, setStatus] = useState<InvoiceFilters['status']>('');
  const [feeId, setFeeId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, feeId, search]);
  const invoices = useInvoices({ status, fee_type_id: feeId, search, page });
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<Invoice | null>(null);
  const data = invoices.data;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Invoices" description="All student invoices. Payments are simulated."
        actions={<Button icon={<FilePlus2 className="size-4" aria-hidden />} onClick={() => setCreating(true)}>Create for student</Button>} />
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[1fr_220px_160px]">
          <div className="relative">
            <label htmlFor="invoice-search" className="sr-only">Search invoices</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input id="invoice-search" type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Invoice number, student name or reg number"
              className="block w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20" />
          </div>
          <SelectField label="Fee" hideLabel value={feeId} onChange={(e) => setFeeId(e.target.value)} placeholder="All fees"
            options={(fees.data ?? []).map((f) => ({ value: f.id, label: f.name }))} />
          <SelectField label="Status" hideLabel value={status} onChange={(e) => setStatus(e.target.value as InvoiceFilters['status'])} placeholder="All statuses"
            options={[{ value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }, { value: 'cancelled', label: 'Cancelled' }]} />
        </div>
        {invoices.isPending ? (
          <TableSkeleton />
        ) : invoices.isError ? (
          <ErrorState error={invoices.error} onRetry={() => invoices.refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No invoices found" message={status || feeId || search ? 'Try other filters.' : 'Students create invoices from the official fees.'} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Invoice</th>
                    <th scope="col" className="px-4 py-3 font-medium">Student</th>
                    <th scope="col" className="px-4 py-3 font-medium">Fee</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                    <th scope="col" className="px-4 py-3 font-medium">Due</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className={`divide-y divide-slate-100 ${invoices.isPlaceholderData ? 'opacity-60' : ''}`}>
                  {data.items.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-semibold text-slate-900">{inv.invoice_number}</p>
                        <p className="text-xs text-slate-500">{formatDay(inv.created_at)}{inv.created_via === 'voice' ? ' · by voice' : ''}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/admin/users/${inv.student.id}`} className="font-medium text-brand-700 hover:underline">{inv.student.full_name}</Link>
                        <p className="font-mono text-xs text-slate-500">{inv.student.reg_number}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{inv.fee_type.name}</td>
                      <td className="px-4 py-3 text-right font-semibold whitespace-nowrap text-slate-900">{formatMoney(inv.amount, inv.currency)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">{formatDay(inv.due_date)}</td>
                      <td className="px-4 py-3"><InvoiceStatusBadge invoice={inv} />{inv.cancel_reason && <p className="mt-1 text-xs text-slate-500">{inv.cancel_reason}</p>}</td>
                      <td className="px-4 py-3 text-right">
                        {inv.status === 'unpaid' && (
                          <button type="button" onClick={() => setCancelling(inv)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-red-700 hover:bg-red-50">
                            <XCircle className="size-4" aria-hidden /> Cancel
                          </button>
                        )}
                        {inv.receipt_payment_id && (
                          <Link to={`/admin/receipts/${inv.receipt_payment_id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-brand-700 hover:bg-slate-100">
                            <Receipt className="size-4" aria-hidden /> Receipt
                          </Link>
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
      {creating && <CreateForStudentDialog onClose={() => setCreating(false)} />}
      {cancelling && <CancelDialog invoice={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}
