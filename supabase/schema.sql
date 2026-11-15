-- Phase 6.1 live sync. Run this once in the Supabase SQL editor.
-- One table, two rows per patient: "up" (the patient's answers) and "down" (the physio's plan).
-- Access is by a secret key per patient, sent in the x-sync-key header. A request with the wrong or no key sees nothing.

create table if not exists public.rehab_sync (
  sync_key   text        not null check (sync_key ~ '^[0-9a-f]{32}$'),
  slice      text        not null check (slice in ('up', 'down')),
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (sync_key, slice)
);

alter table public.rehab_sync enable row level security;

create or replace function public.request_sync_key() returns text
language sql stable as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-sync-key', '')
$$;

drop policy if exists sync_read   on public.rehab_sync;
drop policy if exists sync_insert on public.rehab_sync;
drop policy if exists sync_update on public.rehab_sync;
create policy sync_read   on public.rehab_sync for select to anon using (sync_key = public.request_sync_key());
create policy sync_insert on public.rehab_sync for insert to anon with check (sync_key = public.request_sync_key());
create policy sync_update on public.rehab_sync for update to anon using (sync_key = public.request_sync_key()) with check (sync_key = public.request_sync_key());
-- no delete policy: nothing can be deleted through the public key
