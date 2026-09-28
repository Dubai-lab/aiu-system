/** Student: my invoices, outstanding total, pay / receipt links (spec 12.2). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, Receipt } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { useInvoices, type InvoiceFilters } from '@/features/finance/api';
import { InvoiceStatusBadge } from '@/features/finance/components';
import { formatDay, formatMoney } from '@/features/finance/format';

const TABS: { value: NonNullable<InvoiceFilters['status']>; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function StudentInvoicesPage() {
  const [status, setStatus] = useState<InvoiceFilters['status']>('');
  const invoices = useInvoices({ status });
  const createLink = (
    <Link to="/student/finance/invoices/new" className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800">
      <FilePlus2 className="size-4" aria-hidden /> Create invoice
    </Link>
  );
  const outstanding = invoices.data?.outstanding_total ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="My Invoices" description="Invoices for official university fees and their payment status." actions={createLink} />

      {invoices.data && (
        <div className={`rounded-xl p-5 ring-1 ${outstanding > 0 ? 'bg-amber-50 ring-amber-200' : 'bg-green-50 ring-green-200'}`}>
          <p className="text-sm text-slate-600">Outstanding balance</p>
          <p className="text-2xl font-semibold text-slate-900">{formatMoney(outstanding)}</p>
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div role="tablist" aria-label="Filter invoices" className="flex gap-1 border-b border-slate-200 px-3 pt-3">
          {TABS.map((t) => (
            <button key={t.value} type="button" role="tab" aria-selected={status === t.value} onClick={() => setStatus(t.value)}
              className={`rounded-t-md px-3 py-2 text-sm font-medium ${status === t.value ? 'border-b-2 border-brand-700 text-brand-700' : 'text-slate-500 hover:text-slate-800'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {invoices.isPending ? (
          <TableSkeleton />
        ) : invoices.isError ? (
          <ErrorState error={invoices.error} onRetry={() => invoices.refetch()} />
        ) : invoices.data.items.length === 0 ? (
          <EmptyState title={status ? `No ${status} invoices` : 'No invoices yet - create one'}
            message="Invoices are created from the official fees, so the amount is always correct." action={status ? undefined : createLink} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {invoices.data.items.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{inv.fee_type.name}</p>
                  <p className="text-xs text-slate-500">
                    <span className="font-mono">{inv.invoice_number}</span> · created {formatDay(inv.created_at)}
                    {inv.status === 'unpaid' && <> · due {formatDay(inv.due_date)}</>}
                    {inv.status === 'paid' && inv.paid_at && <> · paid {formatDay(inv.paid_at)}</>}
                  </p>
                </div>
                <p className="font-semibold text-slate-900">{formatMoney(inv.amount, inv.currency)}</p>
                <InvoiceStatusBadge invoice={inv} />
                {inv.status === 'unpaid' && (
                  <Link to={`/student/finance/invoices/${inv.id}/pay`} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
                    Pay
                  </Link>
                )}
                {inv.status === 'paid' && inv.receipt_payment_id && (
                  <Link to={`/student/finance/receipts/${inv.receipt_payment_id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-700 ring-1 ring-slate-300 hover:bg-slate-50">
                    <Receipt className="size-4" aria-hidden /> Receipt
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
