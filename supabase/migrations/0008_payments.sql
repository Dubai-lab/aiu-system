-- =============================================================================
-- 0008_payments.sql
-- record_payment(): records a SIMULATED payment atomically.
--
-- In ONE transaction it locks the invoice row, checks it is still unpaid,
-- generates the receipt reference (PAY-YYYY-NNNNNN), inserts the payment and -
-- if the payment succeeded - marks the invoice paid. So a payment can never be
-- recorded without the invoice being updated (or the other way round), and two
-- clicks on "Pay" can never both succeed (the second waits for the lock, then
-- sees the invoice is already paid).
--
-- Backend-only: executable by service_role only, like every other function.
-- =============================================================================

create or replace function public.record_payment(
  p_invoice_id uuid,
  p_student_id uuid,
  p_method text,
  p_success boolean,
  p_failure_reason text default null
)
returns public.payments
language plpgsql
volatile
set search_path = ''
as $$
declare
  inv public.invoices;
  pay public.payments;
begin
  select * into inv
  from public.invoices
  where id = p_invoice_id and student_id = p_student_id
  for update;                                   -- lock: concurrent payments wait here

  if not found then
    raise exception 'invoice_not_found';
  end if;
  if inv.status <> 'unpaid' then
    raise exception 'invoice_not_payable:%', inv.status;
  end if;

  insert into public.payments (invoice_id, student_id, amount, currency, method, reference,
                               status, failure_reason, is_simulated)
  values (inv.id, inv.student_id, inv.amount, inv.currency, p_method, public.next_payment_reference(),
          case when p_success then 'success' else 'failed' end, p_failure_reason, true)
  returning * into pay;

  if p_success then
    update public.invoices set status = 'paid', paid_at = pay.paid_at where id = inv.id;
  end if;

  return pay;
end;
$$;

revoke execute on function public.record_payment(uuid, uuid, text, boolean, text) from public, anon, authenticated;
grant  execute on function public.record_payment(uuid, uuid, text, boolean, text) to service_role;
