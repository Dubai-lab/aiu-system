/** TanStack Query hooks for fees, invoices and simulated payments. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CreateInvoiceResult, FeeType, Invoice, InvoiceDetail, InvoiceList, Payment, Receipt } from '@/lib/types';

export const financeKeys = {
  all: ['finance'] as const,
  fees: (all: boolean) => ['finance', 'fees', all] as const,
  invoices: (params: string) => ['finance', 'invoices', params] as const,
  invoice: (id: string) => ['finance', 'invoice', id] as const,
  receipt: (id: string) => ['finance', 'receipt', id] as const,
};

function useInvalidateFinance() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: financeKeys.all });
}

// ------------------------------------------------------------------ fees
export function useFees(includeInactive = false) {
  return useQuery({
    queryKey: financeKeys.fees(includeInactive),
    queryFn: () => api.get<FeeType[]>(`/fees${includeInactive ? '?include_inactive=true' : ''}`),
  });
}

export interface FeePayload {
  name: string;
  category: FeeType['category'];
  amount: number;
  currency?: string;
  description?: string | null;
  is_active?: boolean;
}

export function useSaveFee() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<FeePayload> & { id?: string }) =>
      id ? api.patch<FeeType>(`/fees/${id}`, body) : api.post<FeeType>('/fees', body),
    onSuccess: invalidate,
  });
}

// ------------------------------------------------------------------ invoices
export interface InvoiceFilters {
  status?: '' | 'unpaid' | 'paid' | 'cancelled';
  student_id?: string;
  fee_type_id?: string;
  search?: string;
  page?: number;
}

export function useInvoices(f: InvoiceFilters = {}) {
  const p = new URLSearchParams({ page: String(f.page ?? 1), page_size: '20' });
  if (f.status) p.set('status', f.status);
  if (f.student_id) p.set('student_id', f.student_id);
  if (f.fee_type_id) p.set('fee_type_id', f.fee_type_id);
  if (f.search?.trim()) p.set('search', f.search.trim());
  const qs = p.toString();
  return useQuery({
    queryKey: financeKeys.invoices(qs),
    queryFn: () => api.get<InvoiceList>(`/invoices?${qs}`),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string) {
  return useQuery({ queryKey: financeKeys.invoice(id), queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`) });
}

export function useCreateInvoice() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (body: { fee_type_id: string; student_id?: string }) => api.post<CreateInvoiceResult>('/invoices', body),
    onSuccess: invalidate,
  });
}

export function useCancelInvoice() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<InvoiceDetail>(`/invoices/${id}/cancel`, { reason }),
    onSuccess: invalidate,
  });
}

// ------------------------------------------------------------------ payments
export interface PayPayload {
  method: 'card' | 'mobile_money';
  card?: { number: string; expiry: string; cvc: string; name: string };
  phone?: string;
}

export function usePayInvoice(id: string) {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (body: PayPayload) => api.post<{ message: string; payment: Payment; invoice: Invoice }>(`/invoices/${id}/pay`, body),
    // Refresh after failures too: a declined attempt is recorded on the invoice.
    onSettled: invalidate,
  });
}

export function useReceipt(paymentId: string) {
  return useQuery({ queryKey: financeKeys.receipt(paymentId), queryFn: () => api.get<Receipt>(`/payments/${paymentId}`) });
}
