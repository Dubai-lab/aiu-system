/** Student: create an invoice from an official fee (students never type amounts). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/DataStates';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useCreateInvoice, useFees } from '@/features/finance/api';
import { CATEGORY_LABEL, formatDay, formatMoney } from '@/features/finance/format';
import { ApiError } from '@/lib/api';
import type { CreateInvoiceResult } from '@/lib/types';

export default function NewInvoicePage() {
  const fees = useFees();
  const create = useCreateInvoice();
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState<CreateInvoiceResult | null>(null);

  const submit = async () => {
    try {
      setResult(await create.mutateAsync({ fee_type_id: selected }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create the invoice.');
    }
  };

  const back = (
    <Link to="/student/finance/invoices" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
      <ArrowLeft className="size-4" aria-hidden /> Back to my invoices
    </Link>
  );

  if (result) {
    const inv = result.invoice;
    return (
      <div className="mx-auto max-w-xl space-y-6">
        {back}
        <Card>
          <div className="flex flex-col items-center text-center">
            {result.created ? <CheckCircle2 className="size-12 text-green-600" aria-hidden /> : <Info className="size-12 text-amber-500" aria-hidden />}
            <h1 className="mt-3 text-xl font-semibold text-slate-900">{result.created ? 'Invoice created' : 'You already have this invoice'}</h1>
            <p className="mt-2 text-sm text-slate-600" role="status">{result.message}</p>
            <dl className="mt-5 w-full divide-y divide-slate-100 rounded-lg bg-slate-50 px-4 text-left text-sm">
              <div className="flex justify-between py-2"><dt className="text-slate-500">Invoice</dt><dd className="font-mono font-semibold">{inv.invoice_number}</dd></div>
              <div className="flex justify-between py-2"><dt className="text-slate-500">Fee</dt><dd>{inv.fee_type.name}</dd></div>
              <div className="flex justify-between py-2"><dt className="text-slate-500">Amount</dt><dd className="font-semibold">{formatMoney(inv.amount, inv.currency)}</dd></div>
              <div className="flex justify-between py-2"><dt className="text-slate-500">Due</dt><dd>{formatDay(inv.due_date)}</dd></div>
            </dl>
            <p className="mt-5 font-medium text-slate-800">Would you like to pay now, or pay later?</p>
            <div className="mt-3 flex gap-2">
              <Link to={`/student/finance/invoices/${inv.id}/pay`} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800">Pay now</Link>
              <Link to="/student/finance/invoices" className="rounded-lg px-5 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Pay later</Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {back}
      <PageHeader title="Create invoice" description="Choose an official fee. The amount is set by the university." />
      {fees.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
      ) : fees.isError ? (
        <div className="rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={fees.error} onRetry={() => fees.refetch()} /></div>
      ) : fees.data.length === 0 ? (
        <div className="rounded-xl bg-white ring-1 ring-slate-200"><EmptyState title="No fees are available" message="The administrator has not set up any fees yet." /></div>
      ) : (
        <>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Fee</legend>
            {fees.data.map((f) => (
              <label key={f.id}
                className={`flex cursor-pointer flex-col rounded-xl bg-white p-4 shadow-sm ring-2 transition ${selected === f.id ? 'ring-brand-500' : 'ring-slate-200 hover:ring-slate-300'}`}>
                <span className="flex items-start justify-between gap-2">
                  <span className="font-medium text-slate-900">{f.name}</span>
                  <input type="radio" name="fee" value={f.id} checked={selected === f.id} onChange={() => setSelected(f.id)} className="mt-1 accent-brand-700" />
                </span>
                <span className="mt-1 text-xs text-slate-500">{CATEGORY_LABEL[f.category]}{f.description ? ` · ${f.description}` : ''}</span>
                <span className="mt-3 text-lg font-semibold text-brand-700">{formatMoney(f.amount, f.currency)}</span>
              </label>
            ))}
          </fieldset>
          <Button onClick={submit} disabled={!selected} loading={create.isPending} className="w-full sm:w-auto">Create invoice</Button>
        </>
      )}
    </div>
  );
}
