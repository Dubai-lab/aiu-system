-- =============================================================================
-- 0007_rls_guard.sql
-- Safety net: fails loudly if ANY table in the public schema has RLS disabled.
-- Run it after the other migrations (and again after any future migration).
-- =============================================================================
do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')      -- ordinary and partitioned tables
    and not c.relrowsecurity;

  if missing is not null then
    raise exception 'RLS is DISABLED on these public tables: %', missing;
  end if;

  raise notice 'RLS guard passed: every public table has RLS enabled.';
end
$$;
