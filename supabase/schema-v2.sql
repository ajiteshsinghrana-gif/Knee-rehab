-- Phase 6.2 physio login. Run this ONCE in the Supabase SQL editor, AFTER schema.sql (v1).
-- Safe to run again.
--
-- What it adds
--   * rehab_owner: which physio account owns which patient sync key.
--   * Owned patients: only that physio (signed in) can read the patient's rows or write the "down" slice (the plan).
--     The patient's phone, which has no account, can still read both slices and write only the "up" slice (their answers),
--     using the secret key as before.
--   * Patients nobody has claimed yet (made before login existed) behave exactly as in v1, so nothing breaks.
-- Before real patients: also turn on email confirmation and a password policy in Authentication settings. See README.

-- Which physio owns which key. A physio claims a key when adding a patient (the app does this once, automatically).
create table if not exists public.rehab_owner (
  sync_key   text        primary key check (sync_key ~ '^[0-9a-f]{32}$'),
  physio_id  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.rehab_owner enable row level security;

drop policy if exists owner_read   on public.rehab_owner;
drop policy if exists owner_insert on public.rehab_owner;
create policy owner_read   on public.rehab_owner for select to authenticated using (physio_id = (select auth.uid()));
create policy owner_insert on public.rehab_owner for insert to authenticated with check (physio_id = (select auth.uid()));
-- no update or delete policy: a claim cannot be taken over or removed through the public API

-- True when somebody has claimed this key. SECURITY DEFINER so the patient's phone (no account) can ask without reading the table.
create or replace function public.rehab_key_claimed(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rehab_owner o where o.sync_key = k)
$$;
revoke all on function public.rehab_key_claimed(text) from public;
grant execute on function public.rehab_key_claimed(text) to anon, authenticated;

-- Replace the v1 policies on rehab_sync.
drop policy if exists sync_read   on public.rehab_sync;
drop policy if exists sync_insert on public.rehab_sync;
drop policy if exists sync_update on public.rehab_sync;
drop policy if exists patient_read   on public.rehab_sync;
drop policy if exists patient_insert on public.rehab_sync;
drop policy if exists patient_update on public.rehab_sync;
drop policy if exists physio_read    on public.rehab_sync;
drop policy if exists physio_insert  on public.rehab_sync;
drop policy if exists physio_update  on public.rehab_sync;

-- Patient phone (anon, secret key in the x-sync-key header). Reads both slices; writes only "up".
-- A key nobody has claimed (legacy v1 patient) may still write "down", exactly as before.
create policy patient_read   on public.rehab_sync for select to anon
  using (sync_key = public.request_sync_key());
create policy patient_insert on public.rehab_sync for insert to anon
  with check (sync_key = public.request_sync_key() and (slice = 'up' or not public.rehab_key_claimed(sync_key)));
create policy patient_update on public.rehab_sync for update to anon
  using (sync_key = public.request_sync_key() and (slice = 'up' or not public.rehab_key_claimed(sync_key)))
  with check (sync_key = public.request_sync_key() and (slice = 'up' or not public.rehab_key_claimed(sync_key)));

-- Physio (signed in). Reads both slices of patients they own; writes only "down".
create policy physio_read   on public.rehab_sync for select to authenticated
  using (exists (select 1 from public.rehab_owner o where o.sync_key = rehab_sync.sync_key and o.physio_id = (select auth.uid())));
create policy physio_insert on public.rehab_sync for insert to authenticated
  with check (slice = 'down' and exists (select 1 from public.rehab_owner o where o.sync_key = rehab_sync.sync_key and o.physio_id = (select auth.uid())));
create policy physio_update on public.rehab_sync for update to authenticated
  using      (slice = 'down' and exists (select 1 from public.rehab_owner o where o.sync_key = rehab_sync.sync_key and o.physio_id = (select auth.uid())))
  with check (slice = 'down' and exists (select 1 from public.rehab_owner o where o.sync_key = rehab_sync.sync_key and o.physio_id = (select auth.uid())));
-- still no delete policy anywhere
