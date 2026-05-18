-- BEE — Supabase schema
-- Run this once in Supabase SQL editor for your project.
-- Safe to re-run; uses IF NOT EXISTS / OR REPLACE everywhere.

create table if not exists public.bee_days (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  date       date        not null,
  plans      jsonb       not null default '{}'::jsonb,
  actuals    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists bee_days_user_date_idx
  on public.bee_days (user_id, date desc);

alter table public.bee_days enable row level security;

drop policy if exists "bee_days own rows select" on public.bee_days;
drop policy if exists "bee_days own rows insert" on public.bee_days;
drop policy if exists "bee_days own rows update" on public.bee_days;
drop policy if exists "bee_days own rows delete" on public.bee_days;

create policy "bee_days own rows select"
  on public.bee_days for select
  using (auth.uid() = user_id);

create policy "bee_days own rows insert"
  on public.bee_days for insert
  with check (auth.uid() = user_id);

create policy "bee_days own rows update"
  on public.bee_days for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "bee_days own rows delete"
  on public.bee_days for delete
  using (auth.uid() = user_id);

-- Keep updated_at fresh on every modification.
create or replace function public.bee_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bee_days_set_updated_at on public.bee_days;

create trigger bee_days_set_updated_at
  before update on public.bee_days
  for each row execute function public.bee_set_updated_at();
