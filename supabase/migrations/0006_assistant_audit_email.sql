-- =============================================================================
-- 0006_assistant_audit_email.sql
-- Voice assistant history + pending confirmations, audit log, email log.
-- All backend-only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- assistant_conversations
-- -----------------------------------------------------------------------------
create table public.assistant_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assistant_conversations_user_idx
  on public.assistant_conversations (user_id, updated_at desc);
create trigger assistant_conversations_set_updated_at
  before update on public.assistant_conversations
  for each row execute function private.set_updated_at();
alter table public.assistant_conversations enable row level security;
revoke all on table public.assistant_conversations from anon, authenticated;
grant all on table public.assistant_conversations to service_role;

-- -----------------------------------------------------------------------------
-- assistant_messages: Anthropic content blocks (text, tool_use, tool_result).
-- -----------------------------------------------------------------------------
create table public.assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         jsonb not null,
  created_at      timestamptz not null default now()
);
create index assistant_messages_conversation_idx
  on public.assistant_messages (conversation_id, created_at);
alter table public.assistant_messages enable row level security;
revoke all on table public.assistant_messages from anon, authenticated;
grant all on table public.assistant_messages to service_role;

-- -----------------------------------------------------------------------------
-- assistant_pending_actions: sensitive actions waiting for the user to confirm.
-- -----------------------------------------------------------------------------
create table public.assistant_pending_actions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  tool_name       text not null,
  arguments       jsonb not null default '{}'::jsonb,
  summary         text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  expires_at      timestamptz not null default (now() + interval '5 minutes'),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index assistant_pending_actions_user_idx on public.assistant_pending_actions (user_id);
-- Only one pending action per conversation.
create unique index assistant_pending_actions_one_pending
  on public.assistant_pending_actions (conversation_id) where status = 'pending';
alter table public.assistant_pending_actions enable row level security;
revoke all on table public.assistant_pending_actions from anon, authenticated;
grant all on table public.assistant_pending_actions to service_role;

-- -----------------------------------------------------------------------------
-- audit_logs: written by every service that changes data.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,                    -- e.g. 'invoice.create'
  entity     text,                             -- e.g. 'invoice'
  entity_id  text,
  details    jsonb not null default '{}'::jsonb,
  via        text not null default 'ui' check (via in ('ui', 'voice', 'system')),
  ip         text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx   on public.audit_logs (actor_id);
create index audit_logs_action_idx  on public.audit_logs (action);
alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from anon, authenticated;
grant all on table public.audit_logs to service_role;

-- -----------------------------------------------------------------------------
-- email_logs: every send attempt, so failed credential emails can be resent.
-- -----------------------------------------------------------------------------
create table public.email_logs (
  id              uuid primary key default gen_random_uuid(),
  to_email        text not null,
  template        text not null,
  subject         text not null,
  status          text not null check (status in ('sent', 'failed')),
  error           text,
  related_user_id uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index email_logs_related_user_idx on public.email_logs (related_user_id);
create index email_logs_created_idx      on public.email_logs (created_at desc);
alter table public.email_logs enable row level security;
revoke all on table public.email_logs from anon, authenticated;
grant all on table public.email_logs to service_role;
