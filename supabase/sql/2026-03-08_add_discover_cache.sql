-- Discover cache foundation for edge-function-backed reads/writes
-- Infrastructure only: table, updated_at trigger, index, and RLS enablement.

create table if not exists public.discover_cache (
  key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists discover_cache_set_updated_at on public.discover_cache;

create trigger discover_cache_set_updated_at
before update on public.discover_cache
for each row
execute function public.set_updated_at();

create index if not exists discover_cache_updated_at_idx
on public.discover_cache (updated_at desc);

alter table public.discover_cache enable row level security;
