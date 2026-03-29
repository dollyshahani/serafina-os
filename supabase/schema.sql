create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values ('serafina-assets', 'serafina-assets', true)
on conflict (id) do nothing;

create table if not exists public.app_snapshots (
  workspace text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  topic text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

alter table public.app_snapshots enable row level security;
alter table public.sync_runs enable row level security;
alter table public.webhook_events enable row level security;

create policy "service role only snapshots"
on public.app_snapshots
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role only sync runs"
on public.sync_runs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role only webhook events"
on public.webhook_events
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
