import type { FeeCategory } from '@/lib/types';

/** "4,500.00 USD" */
export function formatMoney(amount: number, currency = 'USD'): string {
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function formatDay(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const CATEGORY_LABEL: Record<FeeCategory, string> = {
  tuition: 'Tuition',
  medical_insurance: 'Medical insurance',
  registration: 'Registration',
  other: 'Other',
};
