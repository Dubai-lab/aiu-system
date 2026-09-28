/** Student: SIMULATED checkout - card or mobile money with fake details (spec 12.3). */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CreditCard, Lock, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState, Skeleton } from '@/components/DataStates';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { useInvoice, usePayInvoice } from '@/features/finance/api';
import { InvoiceStatusBadge, SimulatedBadge } from '@/features/finance/components';
import { formatDay, formatMoney } from '@/features/finance/format';
import { ApiError } from '@/lib/api';

type Method = 'card' | 'mobile_money';

/** "4242424242424242" -> "4242 4242 4242 4242" while typing. */
const groupCard = (v: string) => v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
const formatExpiry = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

export default function CheckoutPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const invoice = useInvoice(id);
  const pay = usePayInvoice(id);
  const [method, setMethod] = useState<Method>('card');
  const [card, setCard] = useState({ number: '', expiry: '', cvc: '', name: '' });
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (invoice.isPending) return <div className="mx-auto max-w-2xl space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (invoice.isError) return <div className="mx-auto max-w-2xl rounded-xl bg-white ring-1 ring-slate-200"><ErrorState error={invoice.error} onRetry={() => invoice.refetch()} /></div>;
  const inv = invoice.data;

  const back = (
    <Link to="/student/finance/invoices" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
      <ArrowLeft className="size-4" aria-hidden /> Back to my invoices
    </Link>
  );

  if (inv.status !== 'unpaid') {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        {back}
        <Card>
          <p className="text-center text-slate-700">
            Invoice <span className="font-mono">{inv.invoice_number}</span> is {inv.status}.{' '}
            {inv.receipt_payment_id && <Link to={`/student/finance/receipts/${inv.receipt_payment_id}`} className="text-brand-700 underline">View the receipt</Link>}
          </p>
        </Card>
      </div>
    );
  }

  const validate = () => {
    const e: Record<string, string> = {};
    if (method === 'card') {
      if (card.number.replace(/\D/g, '').length !== 16) e.number = 'Enter a 16-digit card number.';
      if (!/^\d{2}\/\d{2}$/.test(card.expiry)) e.expiry = 'Use MM/YY.';
      if (!/^\d{3,4}$/.test(card.cvc)) e.cvc = '3 digits.';
      if (card.name.trim().length < 2) e.name = 'Enter the name on the card.';
    } else if (phone.replace(/\D/g, '').length < 7) {
      e.phone = 'Enter a valid mobile money number.';
    }
    return e;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const r = await pay.mutateAsync(method === 'card'
        ? { method, card: { ...card, number: card.number.replace(/\s/g, ''), name: card.name.trim() } }
        : { method, phone });
      toast.success(r.message);
      navigate(`/student/finance/receipts/${r.payment.id}`, { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'The payment could not be completed.';
      setErrors({ form: msg });
    }
  };

  const tab = (m: Method, label: string, Icon: typeof CreditCard) => (
    <button type="button" role="tab" aria-selected={method === m} onClick={() => { setMethod(m); setErrors({}); }}
      className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${method === m ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {back}
      <h1 className="text-2xl font-semibold text-slate-900">Checkout</h1>
      <SimulatedBadge />

      <Card title="Invoice summary">
        <dl className="divide-y divide-slate-100 text-sm">
          <div className="flex justify-between py-2"><dt className="text-slate-500">Invoice</dt><dd className="font-mono">{inv.invoice_number}</dd></div>
          <div className="flex justify-between py-2"><dt className="text-slate-500">Fee</dt><dd>{inv.fee_type.name}</dd></div>
          <div className="flex justify-between py-2"><dt className="text-slate-500">Due</dt><dd className="flex items-center gap-2">{formatDay(inv.due_date)} <InvoiceStatusBadge invoice={inv} /></dd></div>
          <div className="flex justify-between py-3 text-base"><dt className="font-medium text-slate-700">Amount to pay</dt><dd className="font-semibold text-slate-900">{formatMoney(inv.amount, inv.currency)}</dd></div>
        </dl>
      </Card>

      <Card title="Payment method">
        <div role="tablist" aria-label="Payment method" className="mb-5 flex gap-1 rounded-lg bg-slate-100 p-1">
          {tab('card', 'Card', CreditCard)}
          {tab('mobile_money', 'Mobile Money', Smartphone)}
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {method === 'card' ? (
            <>
              <TextField label="Card number" inputMode="numeric" autoComplete="off" value={card.number}
                onChange={(e) => setCard((c) => ({ ...c, number: groupCard(e.target.value) }))} error={errors.number}
                placeholder="4242 4242 4242 4242" hint="Any 16 digits work. 4000 0000 0000 0002 simulates a declined card." />
              <div className="grid grid-cols-2 gap-4">
                <TextField label="Expiry (MM/YY)" inputMode="numeric" autoComplete="off" value={card.expiry}
                  onChange={(e) => setCard((c) => ({ ...c, expiry: formatExpiry(e.target.value) }))} error={errors.expiry} placeholder="12/28" />
                <TextField label="CVC" inputMode="numeric" autoComplete="off" value={card.cvc} maxLength={4}
                  onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value.replace(/\D/g, '') }))} error={errors.cvc} placeholder="123" />
              </div>
              <TextField label="Name on card" autoComplete="off" value={card.name}
                onChange={(e) => setCard((c) => ({ ...c, name: e.target.value }))} error={errors.name} />
            </>
          ) : (
            <TextField label="Mobile money number" type="tel" inputMode="tel" autoComplete="off" value={phone}
              onChange={(e) => setPhone(e.target.value)} error={errors.phone} placeholder="+231 77 000 0000"
              hint="Any phone number works - this is a simulation." />
          )}
          {errors.form && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.form}</p>}
          <Button type="submit" loading={pay.isPending} icon={<Lock className="size-4" aria-hidden />} className="w-full py-3 text-base">
            Pay {formatMoney(inv.amount, inv.currency)}
          </Button>
          <p className="text-center text-xs text-slate-500">Card details are only checked for format and are never stored.</p>
        </form>
      </Card>
    </div>
  );
}
