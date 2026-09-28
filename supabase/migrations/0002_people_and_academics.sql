-- =============================================================================
-- 0002_people_and_academics.sql
-- departments, profiles, courses, enrollments + the RLS helper functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- departments (backend-only)
-- -----------------------------------------------------------------------------
create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0),
  code       text not null unique check (code ~ '^[A-Z]{2,6}$'),
  created_at timestamptz not null default now()
);
alter table public.departments enable row level security;
revoke all on table public.departments from anon, authenticated;
grant all on table public.departments to service_role;

-- -----------------------------------------------------------------------------
-- profiles: one row per user; role here is the source of truth.
-- The browser may read ONLY its own row.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  role                 text not null check (role in ('admin', 'teacher', 'student')),
  full_name            text not null check (length(trim(full_name)) > 0),
  email                text not null unique check (email = lower(email)),
  reg_number           text unique check (reg_number = upper(reg_number)),
  staff_title          text,
  department_id        uuid references public.departments (id) on delete restrict,
  level                smallint check (level in (100, 200, 300, 400)),
  intake_year          smallint check (intake_year between 2000 and 2100),
  phone                text,
  face_enrolled        boolean not null default false,
  must_change_password boolean not null default true,
  is_active            boolean not null default true,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Students must have reg number, department, level and intake year;
  -- staff must not have a reg number.
  constraint profiles_student_fields check (
    (role = 'student'
       and reg_number is not null and department_id is not null
       and level is not null and intake_year is not null)
    or (role <> 'student' and reg_number is null)
  )
);
create index profiles_department_idx on public.profiles (department_id);
create index profiles_role_idx       on public.profiles (role);
create index profiles_created_by_idx on public.profiles (created_by);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

create policy "profiles: users read own row"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- courses (backend-only). One teacher per course.
-- -----------------------------------------------------------------------------
create table public.courses (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z]{2,6}[0-9]{3}$'),
  title         text not null check (length(trim(title)) > 0),
  department_id uuid not null references public.departments (id) on delete restrict,
  credits       smallint not null default 3 check (credits between 1 and 10),
  semester      smallint not null default 1 check (semester between 1 and 3),
  teacher_id    uuid references public.profiles (id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index courses_department_idx on public.courses (department_id);
create index courses_teacher_idx    on public.courses (teacher_id);
alter table public.courses enable row level security;
revoke all on table public.courses from anon, authenticated;
grant all on table public.courses to service_role;

-- -----------------------------------------------------------------------------
-- enrollments (backend-only)
-- -----------------------------------------------------------------------------
create table public.enrollments (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_id, student_id)
);
create index enrollments_student_idx on public.enrollments (student_id);
alter table public.enrollments enable row level security;
revoke all on table public.enrollments from anon, authenticated;
grant all on table public.enrollments to service_role;

-- -----------------------------------------------------------------------------
-- RLS helper functions (security definer, fixed empty search_path).
-- They read profiles/enrollments with the owner's rights, so policies that use
-- them never recurse into profiles' own RLS.
-- -----------------------------------------------------------------------------

-- True when the caller has an active profile.
create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

-- True when the caller is enrolled in the given course.
create or replace function private.is_enrolled(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e
    where e.course_id = p_course_id
      and e.student_id = (select auth.uid())
  );
$$;

revoke execute on function private.is_active_user()   from public, anon;
revoke execute on function private.is_enrolled(uuid)  from public, anon;
grant  execute on function private.is_active_user()   to authenticated, service_role;
grant  execute on function private.is_enrolled(uuid)  to authenticated, service_role;
