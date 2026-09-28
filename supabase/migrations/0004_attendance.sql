-- =============================================================================
-- 0004_attendance.sql
-- Attendance sessions, their class codes, and attendance records.
-- Sessions and records are readable by the browser (Realtime) under strict RLS.
--
-- IMPORTANT DESIGN NOTE: the 6-digit class code is kept in a SEPARATE,
-- backend-only table (attendance_session_codes). If the code were a column of
-- attendance_sessions, the Realtime/SELECT policy that lets enrolled students
-- see open sessions would also hand them the code, and a student at home could
-- mark attendance without seeing the board. Teachers get the code through the
-- backend API instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- attendance_sessions
-- A session is open while status = 'open' and now() < closes_at.
-- -----------------------------------------------------------------------------
create table public.attendance_sessions (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  teacher_id  uuid not null references public.profiles (id),
  title       text not null check (length(trim(title)) > 0),
  opens_at    timestamptz not null default now(),
  closes_at   timestamptz not null,
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_via text not null default 'ui' check (created_via in ('ui', 'voice')),
  created_at  timestamptz not null default now(),
  check (closes_at > opens_at)
);
create index attendance_sessions_course_idx  on public.attendance_sessions (course_id);
create index attendance_sessions_teacher_idx on public.attendance_sessions (teacher_id);
-- Only one open session per course at a time.
create unique index attendance_sessions_one_open_per_course
  on public.attendance_sessions (course_id) where status = 'open';

alter table public.attendance_sessions enable row level security;
revoke all on table public.attendance_sessions from anon, authenticated;
grant select on table public.attendance_sessions to authenticated;
grant all on table public.attendance_sessions to service_role;

-- -----------------------------------------------------------------------------
-- attendance_session_codes (backend-only; see design note above)
-- -----------------------------------------------------------------------------
create table public.attendance_session_codes (
  session_id uuid primary key references public.attendance_sessions (id) on delete cascade,
  code       text not null check (code ~ '^[0-9]{6}$'),
  updated_at timestamptz not null default now()
);
create trigger attendance_session_codes_set_updated_at
  before update on public.attendance_session_codes
  for each row execute function private.set_updated_at();
alter table public.attendance_session_codes enable row level security;
revoke all on table public.attendance_session_codes from anon, authenticated;
grant all on table public.attendance_session_codes to service_role;

-- -----------------------------------------------------------------------------
-- attendance_records: one record per student per session.
-- -----------------------------------------------------------------------------
create table public.attendance_records (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.attendance_sessions (id) on delete cascade,
  student_id      uuid not null references public.profiles (id) on delete cascade,
  marked_at       timestamptz not null default now(),
  method          text not null check (method in ('face', 'manual')),
  similarity      real,
  liveness_passed boolean not null default false,
  manual_reason   text,
  marked_by       uuid references public.profiles (id) on delete set null,
  unique (session_id, student_id),
  -- a manual mark must always carry a reason
  check (method <> 'manual' or (manual_reason is not null and length(trim(manual_reason)) > 0))
);
create index attendance_records_student_idx   on public.attendance_records (student_id);
create index attendance_records_marked_by_idx on public.attendance_records (marked_by);

alter table public.attendance_records enable row level security;
revoke all on table public.attendance_records from anon, authenticated;
grant select on table public.attendance_records to authenticated;
grant all on table public.attendance_records to service_role;

-- -----------------------------------------------------------------------------
-- Helper: true when the caller is the teacher who owns the session.
-- -----------------------------------------------------------------------------
create or replace function private.owns_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_sessions s
    where s.id = p_session_id
      and s.teacher_id = (select auth.uid())
  );
$$;
revoke execute on function private.owns_session(uuid) from public, anon;
grant  execute on function private.owns_session(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- SELECT policies (the ONLY browser access). No INSERT/UPDATE/DELETE policies
-- exist, so the browser cannot write; the backend writes with service_role.
-- -----------------------------------------------------------------------------

-- Teachers see sessions they run; students see sessions of courses they take.
create policy "attendance_sessions: owner teacher or enrolled student can read"
  on public.attendance_sessions
  for select
  to authenticated
  using (
    (select private.is_active_user())
    and (
      teacher_id = (select auth.uid())
      or private.is_enrolled(course_id)
    )
  );

-- Students see their own records; teachers see records of their own sessions.
create policy "attendance_records: own record or owning teacher can read"
  on public.attendance_records
  for select
  to authenticated
  using (
    (select private.is_active_user())
    and (
      student_id = (select auth.uid())
      or private.owns_session(session_id)
    )
  );

-- -----------------------------------------------------------------------------
-- Realtime: publish sessions and records (RLS above is applied per subscriber).
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_sessions'
  ) then
    alter publication supabase_realtime add table public.attendance_sessions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance_records'
  ) then
    alter publication supabase_realtime add table public.attendance_records;
  end if;
end
$$;
