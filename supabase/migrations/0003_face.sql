-- =============================================================================
-- 0003_face.sql
-- Face embeddings (no images are ever stored), liveness challenges, and the
-- matching functions. All backend-only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- face_embeddings: one averaged, L2-normalised 512-d ArcFace embedding per user.
-- -----------------------------------------------------------------------------
create table public.face_embeddings (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  embedding  extensions.vector(512) not null,
  samples    int not null default 5 check (samples > 0),
  model      text not null default 'buffalo_l',
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger face_embeddings_set_updated_at
  before update on public.face_embeddings
  for each row execute function private.set_updated_at();
alter table public.face_embeddings enable row level security;
revoke all on table public.face_embeddings from anon, authenticated;
grant all on table public.face_embeddings to service_role;

-- -----------------------------------------------------------------------------
-- face_challenges: single-use liveness challenges, valid for 90 seconds.
-- -----------------------------------------------------------------------------
create table public.face_challenges (
  id         uuid primary key default gen_random_uuid(),
  purpose    text not null check (purpose in ('login', 'attendance')),
  user_id    uuid references public.profiles (id) on delete cascade, -- null for login
  steps      jsonb not null,                                          -- e.g. ["center","turn_left"]
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  used_at    timestamptz,
  ip         text,
  created_at timestamptz not null default now()
);
create index face_challenges_user_idx    on public.face_challenges (user_id);
create index face_challenges_expires_idx on public.face_challenges (expires_at);
alter table public.face_challenges enable row level security;
revoke all on table public.face_challenges from anon, authenticated;
grant all on table public.face_challenges to service_role;

-- -----------------------------------------------------------------------------
-- 1:N identification for face login: the closest ACTIVE users.
-- <=> is pgvector's cosine distance, so similarity = 1 - distance. ArcFace
-- embeddings are L2-normalised, so this equals InsightFace's cosine similarity.
--
-- SECURITY INVOKER (not definer) is deliberate: only service_role may execute
-- it, and service_role already bypasses RLS, so definer rights add nothing.
-- -----------------------------------------------------------------------------
create or replace function public.match_faces(
  query extensions.vector(512),
  match_count int default 2
)
returns table (user_id uuid, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select fe.user_id, 1 - (fe.embedding <=> query) as similarity
  from public.face_embeddings fe
  join public.profiles p on p.id = fe.user_id
  where p.is_active
  order by fe.embedding <=> query
  limit match_count;
$$;

-- 1:1 verification for attendance: similarity against ONE user's embedding.
-- Returns null when that user has no enrolled face.
create or replace function public.verify_face(
  p_user_id uuid,
  query extensions.vector(512)
)
returns float
language sql
stable
set search_path = public, extensions
as $$
  select 1 - (fe.embedding <=> query)
  from public.face_embeddings fe
  where fe.user_id = p_user_id;
$$;

revoke execute on function public.match_faces(extensions.vector, int)  from public, anon, authenticated;
revoke execute on function public.verify_face(uuid, extensions.vector) from public, anon, authenticated;
grant  execute on function public.match_faces(extensions.vector, int)  to service_role;
grant  execute on function public.verify_face(uuid, extensions.vector) to service_role;
