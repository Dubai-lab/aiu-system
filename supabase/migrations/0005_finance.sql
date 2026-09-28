-- =============================================================================
-- 0005_finance.sql
-- Fee types, invoices and simulated payments. All backend-only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fee_types: official amounts set by the admin. Students never type amounts.
-- -----------------------------------------------------------------------------
create table public.fee_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  category    text not null check (category in ('tuition', 'medical_insurance', 'registration', 'other')),
  amount      numeric(12, 2) not null check (amount > 0),
  currency    text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger fee_types_set_updated_at
  before update on public.fee_types
  for each row execute function private.set_updated_at();
alter table public.fee_types enable row level security;
revoke all on table public.fee_types from anon, authenticated;
grant all on table public.fee_types to service_role;

-- -----------------------------------------------------------------------------
-- invoices: the amount is COPIED from the fee type at creation time.
-- -----------------------------------------------------------------------------
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  student_id     uuid not null references public.profiles (id),
  fee_type_id    uuid not null references public.fee_types (id),
  description    text,
  amount         numeric(12, 2) not null check (amount > 0),
  currency       text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status         text not null default 'unpaid' check (status in ('unpaid', 'paid', 'cancelled')),
  due_date       date not null,
  created_by     uuid references public.profiles (id) on delete set null,
  created_via    text not null default 'ui' check (created_via in ('ui', 'voice')),
  created_at     timestamptz not null default now(),
  paid_at        timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.profiles (id) on delete set null,
  cancel_reason  text,
  check (status <> 'paid' or paid_at is not null),
  check (status <> 'cancelled' or (cancelled_at is not null and cancel_reason is not null))
);
create index invoices_student_idx      on public.invoices (student_id);
create index invoices_fee_type_idx     on public.invoices (fee_type_id);
create index invoices_status_idx       on public.invoices (status);
create index invoices_created_by_idx   on public.invoices (created_by);
create index invoices_cancelled_by_idx on public.invoices (cancelled_by);
-- Database-level guarantee: never two UNPAID invoices for the same fee and student.
create unique index invoices_one_unpaid_per_fee
  on public.invoices (student_id, fee_type_id) where status = 'unpaid';

alter table public.invoices enable row level security;
revoke all on table public.invoices from anon, authenticated;
grant all on table public.invoices to service_role;

-- -----------------------------------------------------------------------------
-- payments: simulated only. No real money is ever charged.
-- -----------------------------------------------------------------------------
create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices (id),
  student_id     uuid not null references public.profiles (id),
  amount         numeric(12, 2) not null check (amount > 0),
  currency       text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  method         text not null check (method in ('card', 'mobile_money')),
  reference      text not null unique,
  status         text not null check (status in ('success', 'failed')),
  failure_reason text,
  is_simulated   boolean not null default true,
  paid_at        timestamptz not null default now()
);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_student_idx on public.payments (student_id);
-- An invoice can be successfully paid only once.
create unique index payments_one_success_per_invoice
  on public.payments (invoice_id) where status = 'success';

alter table public.payments enable row level security;
revoke all on table public.payments from anon, authenticated;
grant all on table public.payments to service_role;
