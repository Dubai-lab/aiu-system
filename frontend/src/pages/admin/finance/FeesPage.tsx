/** Admin: official fee types (spec 12.1). Amount changes apply to new invoices only. */
import { useState, type FormEvent } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/DataStates';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { useFees, useSaveFee } from '@/features/finance/api';
import { CATEGORY_LABEL, formatMoney } from '@/features/finance/format';
import { ApiError } from '@/lib/api';
import type { FeeCategory, FeeType } from '@/lib/types';

function FeeDialog({ fee, onClose }: { fee: FeeType | null; onClose: () => void }) {
  const save = useSaveFee();
  const [form, setForm] = useState({
    name: fee?.name ?? '',
    category: (fee?.category ?? 'tuition') as FeeCategory,
    amount: fee ? String(fee.amount) : '',
    description: fee?.description ?? '',
    is_active: fee?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount);
    const found: Record<string, string> = {};
    if (form.name.trim().length < 2) found.name = 'Enter the fee name.';
    if (!(amount > 0) || !/^\d+(\.\d{1,2})?$/.test(form.amount.trim())) found.amount = 'Enter an amount such as 4500 or 4500.50.';
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      await save.mutateAsync({
        id: fee?.id, name: form.name.trim(), category: form.category, amount,
        description: form.description.trim() || null, ...(fee ? { is_active: form.is_active } : {}),
      });
      toast.success(fee ? 'Fee updated.' : 'Fee created.');
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Could not save the fee.' });
    }
  };

  const amountChanged = fee && Number(form.amount) !== fee.amount;
  return (
    <Dialog open onClose={onClose} title={fee ? 'Edit fee' : 'New fee'}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name}
          placeholder="e.g. Tuition Fee - Semester 2" />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as FeeCategory }))}
            options={(Object.keys(CATEGORY_LABEL) as FeeCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
          <TextField label="Amount (USD)" inputMode="decimal" value={form.amount} error={errors.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') }))} placeholder="4500" />
        </div>
        {amountChanged && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The new amount applies to invoices created from now on. Existing invoices keep their amount.
          </p>
        )}
        <TextField label="Description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        {fee && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="size-4 accent-brand-700" checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
            Offered to students (students can create invoices for it)
          </label>
        )}
        {errors.form && <p role="alert" className="text-sm text-red-600">{errors.form}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{fee ? 'Save' : 'Create fee'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function FeesPage() {
  const fees = useFees(true);
  const [editing, setEditing] = useState<FeeType | 'new' | null>(null);
  const add = <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>New fee</Button>;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Fees" description="Official fee amounts. Students choose from these - they never type an amount." actions={add} />
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {fees.isPending ? (
          <TableSkeleton rows={4} />
        ) : fees.isError ? (
          <ErrorState error={fees.error} onRetry={() => fees.refetch()} />
        ) : fees.data.length === 0 ? (
          <EmptyState title="No fees yet" message="Create the official fees students will be invoiced for." action={add} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Fee</th>
                  <th scope="col" className="px-4 py-3 font-medium">Category</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fees.data.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{f.name}</p>
                      {f.description && <p className="text-xs text-slate-500">{f.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{CATEGORY_LABEL[f.category]}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">{formatMoney(f.amount, f.currency)}</td>
                    <td className="px-4 py-3">{f.is_active ? <Badge tone="green">Offered</Badge> : <Badge tone="slate">Not offered</Badge>}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setEditing(f)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Edit ${f.name}`}>
                        <Pencil className="size-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <FeeDialog fee={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
