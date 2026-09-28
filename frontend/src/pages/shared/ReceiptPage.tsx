/** Printable payment receipt (students: own; admins: any). window.print + print styles. */
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { ErrorState, Skeleton } from '@/components/DataStates';
import { Button } from '@/components/ui/Button';
import { useReceipt } from '@/features/finance/api';
import { formatMoney } from '@/features/finance/format';

export default function ReceiptPage() {
  const { paymentId = '' } = useParams();
  const { profile } = useAuth();
  const receipt = useReceipt(paymentId);
  const backTo = profile?.role === 'admin' ? '/admin/invoices' : '/student/finance/invoices';

  if (receipt.isPending) return <div className="mx-auto max-w-2xl space-y-4"><Skeleton className="h-96 w-full" /></div>;
  if (receipt.isError) return <div className="mx-auto max-w-2xl rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={receipt.error} onRetry={() => receipt.refetch()} /></div>;
  const r = receipt.data;
  const p = r.payment;
  const rows: [string, string][] = [
    ['Receipt reference', p.reference],
    ['Student', r.student.full_name],
    ['Registration number', r.student.reg_number ?? '-'],
    ...(r.department ? ([['Department', r.department]] as [string, string][]) : []),
    ['Invoice', r.invoice_number],
    ['Fee', r.fee_name],
    ['Payment method', p.method === 'card' ? 'Card' : 'Mobile Money'],
    ['Date', new Date(p.paid_at).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })],
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="size-4" aria-hidden /> Back to invoices
        </Link>
        <Button variant="secondary" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>Print receipt</Button>
      </div>

      <article className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200 print:rounded-none print:p-0 print:shadow-none print:ring-0" aria-label="Payment receipt">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-xl bg-brand-700 font-bold text-accent-400 print:border print:border-slate-900 print:bg-white print:text-slate-900">
              {r.university}
            </span>
            <div>
              <p className="text-lg font-semibold text-slate-900">{r.university}</p>
              <p className="text-sm text-slate-500">Official payment receipt</p>
            </div>
          </div>
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-800 print:border print:border-slate-900 print:bg-white">PAID</span>
        </header>

        <p className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm font-semibold text-amber-900 print:border-slate-900 print:bg-white">
          SIMULATED PAYMENT - no real money was charged
        </p>

        <dl className="mt-5 divide-y divide-slate-100 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">{label}</dt>
              <dd className={`text-right text-slate-900 ${label.includes('reference') || label === 'Invoice' || label === 'Registration number' ? 'font-mono' : ''}`}>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-4 py-4 print:bg-white print:px-0">
          <span className="font-medium text-slate-700">Amount paid</span>
          <span className="text-2xl font-bold text-slate-900">{formatMoney(p.amount, p.currency)}</span>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">A copy of this receipt was sent to {r.student.email}.</p>
      </article>
    </div>
  );
}
