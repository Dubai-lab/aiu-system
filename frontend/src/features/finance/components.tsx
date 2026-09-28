/** Small shared finance UI pieces. */
import { FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import type { Invoice } from '@/lib/types';

/** Spec 12.3: every payment screen clearly says the payment is simulated. */
export function SimulatedBadge({ className = '' }: { className?: string }) {
  return (
    <p role="note" className={`flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 ${className}`}>
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      Simulated payment - no real money is charged
    </p>
  );
}

export function InvoiceStatusBadge({ invoice }: { invoice: Pick<Invoice, 'status' | 'overdue'> }) {
  if (invoice.status === 'paid') return <Badge tone="green">Paid</Badge>;
  if (invoice.status === 'cancelled') return <Badge tone="slate">Cancelled</Badge>;
  return invoice.overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Unpaid</Badge>;
}
