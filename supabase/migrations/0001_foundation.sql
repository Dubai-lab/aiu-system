-- =============================================================================
-- 0001_foundation.sql
-- Extensions, the private helper schema, shared trigger functions, and the
-- collision-free number generators (registration numbers, invoices, payments).
--
-- Security model used throughout every migration (see spec Section 16):
--   * The browser NEVER writes to any table. All writes go through the FastAPI
--     backend using the service_role key, which bypasses RLS.
--   * RLS is enabled on every table in the same migration that creates it.
--   * Tables the browser never reads have RLS on and NO policies (default deny),
--     and their privileges are revoked from anon/authenticated as a second lock.
--   * Only three tables get a SELECT policy for the browser (profiles,
--     attendance_sessions, attendance_records) because Realtime needs them.
-- =============================================================================

-- pgvector lives in the "extensions" schema, as Supabase recommends.
create extension if not exists vector with schema extensions;

-- -----------------------------------------------------------------------------
-- private schema: helper functions used inside RLS policies.
-- It is NOT exposed through the Data API, so these functions cannot be called
-- from the browser as RPCs, but policies can still use them.
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Keeps updated_at current on every UPDATE.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Number generators.
-- A single counters table with an atomic upsert gives per-year sequences that
-- never collide, even under concurrent requests (the row is locked by the
-- ON CONFLICT DO UPDATE until the transaction ends).
-- -----------------------------------------------------------------------------
create table public.number_counters (
  scope text primary key,          -- e.g. 'reg:2026', 'inv:2026', 'pay:2026'
  value bigint not null default 0
);
alter table public.number_counters enable row level security;
revoke all on table public.number_counters from anon, authenticated;
grant all on table public.number_counters to service_role;

create or replace function public.next_number(p_scope text)
returns bigint
language sql
volatile
set search_path = ''
as $$
  insert into public.number_counters as c (scope, value)
  values (p_scope, 1)
  on conflict (scope) do update set value = c.value + 1
  returning c.value;
$$;

-- Zero-pads to at least p_width digits (never truncates if the number grows).
create or replace function private.pad_number(p_n bigint, p_width int)
returns text
language sql
immutable
set search_path = ''
as $$
  select lpad(p_n::text, greatest(p_width, length(p_n::text)), '0');
$$;

-- AIU-YYYY-NNNN, where YYYY is the student's intake year.
create or replace function public.next_reg_number(p_intake_year int)
returns text
language sql
volatile
set search_path = ''
as $$
  select 'AIU-' || p_intake_year::text || '-'
         || private.pad_number(public.next_number('reg:' || p_intake_year::text), 4);
$$;

-- INV-YYYY-NNNNNN (current year).
create or replace function public.next_invoice_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'INV-' || to_char(now(), 'YYYY') || '-'
         || private.pad_number(public.next_number('inv:' || to_char(now(), 'YYYY')), 6);
$$;

-- PAY-YYYY-NNNNNN (current year).
create or replace function public.next_payment_reference()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'PAY-' || to_char(now(), 'YYYY') || '-'
         || private.pad_number(public.next_number('pay:' || to_char(now(), 'YYYY')), 6);
$$;

-- Only the backend (service_role) may generate numbers.
revoke execute on function public.next_number(text)          from public, anon, authenticated;
revoke execute on function public.next_reg_number(int)       from public, anon, authenticated;
revoke execute on function public.next_invoice_number()      from public, anon, authenticated;
revoke execute on function public.next_payment_reference()   from public, anon, authenticated;
revoke execute on function private.pad_number(bigint, int)   from public, anon, authenticated;
grant  execute on function public.next_number(text)          to service_role;
grant  execute on function public.next_reg_number(int)       to service_role;
grant  execute on function public.next_invoice_number()      to service_role;
grant  execute on function public.next_payment_reference()   to service_role;
grant  execute on function private.pad_number(bigint, int)   to service_role;

-- -----------------------------------------------------------------------------
-- Rate limiting (login, face login, class code attempts, assistant messages).
-- Stored in the database so limits survive a backend restart.
-- -----------------------------------------------------------------------------
create table public.rate_limit_hits (
  id         bigint generated always as identity primary key,
  bucket     text not null,        -- e.g. 'login', 'face_login', 'class_code', 'assistant'
  key        text not null,        -- e.g. 'AIU-2026-0001|127.0.0.1'
  created_at timestamptz not null default now()
);
create index rate_limit_hits_lookup_idx on public.rate_limit_hits (bucket, key, created_at desc);
alter table public.rate_limit_hits enable row level security;
revoke all on table public.rate_limit_hits from anon, authenticated;
grant all on table public.rate_limit_hits to service_role;
