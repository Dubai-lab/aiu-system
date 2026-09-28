/** Student dashboard: outstanding invoices with Pay buttons (spec 14.1). */
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/DataStates';
import { useInvoices } from './api';
import { InvoiceStatusBadge } from './components';
import { formatDay, formatMoney } from './format';

export function OutstandingInvoicesPanel() {
  const invoices = useInvoices({ status: 'unpaid' });
  if (invoices.isPending) return <Skeleton className="h-28 w-full rounded-xl" />;
  if (invoices.isError) return null; // the invoices page shows the full error; keep the dashboard calm
  const items = invoices.data.items;
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Outstanding invoices</h2>
        <Link to="/student/finance/invoices" className="text-sm text-brand-700 hover:underline">View all</Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nothing to pay. You're all settled.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-slate-100">
            {items.slice(0, 3).map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{inv.fee_type.name}</span>
                  <span className="block text-xs text-slate-500"><span className="font-mono">{inv.invoice_number}</span> · due {formatDay(inv.due_date)}</span>
                </span>
                <span className="text-sm font-semibold text-slate-900">{formatMoney(inv.amount, inv.currency)}</span>
                <InvoiceStatusBadge invoice={inv} />
                <Link to={`/student/finance/invoices/${inv.id}/pay`} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">Pay</Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-right text-sm text-slate-600">Total outstanding: <span className="font-semibold">{formatMoney(invoices.data.outstanding_total ?? 0)}</span></p>
        </>
      )}
    </section>
  );
}
