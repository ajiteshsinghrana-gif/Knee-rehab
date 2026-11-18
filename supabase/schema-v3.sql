-- Phase 6.3 patient accounts. Run this ONCE in the Supabase SQL editor, AFTER schema.sql and schema-v2.sql. Safe to run again.
--
-- What it adds
--   * rehab_patient: a patient's own account (email + password, Supabase Auth) linked to one patient key.
--     The first person to open a patient's invite link creates the account and claims the key. The invite is stored with the
--     claim so the patient can sign in on any phone and get the plan back. The physio can see which email claimed the link
--     and can reset the link if the wrong person claimed it.
--   * Claimed patients: only that account (the patient) and the owning physio can read or write the patient's rows.
--     The patient writes only "up" (answers); the physio writes only "down" (plan). The secret link alone stops working.
--   * Unclaimed patients behave exactly as before (secret link), so nothing breaks.

create table if not exists public.rehab_patient (
  sync_key   text        primary key check (sync_key ~ '^[0-9a-f]{32}$'),
  patient_id uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  email      text        default (auth.jwt() ->> 'email'),
  invite     text        not null check (char_length(invite) between 20 and 60000),
  created_at timestamptz not null default now()
);
alter table public.rehab_patient enable row level security;

-- True when a patient account has claimed this key. SECURITY DEFINER so policies can ask without reading the table.
create or replace function public.rehab_key_has_patient(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rehab_patient p where p.sync_key = k)
$$;
revoke all on function public.rehab_key_has_patient(text) from public;
grant execute on function public.rehab_key_has_patient(text) to anon, authenticated;

drop policy if exists patient_own_read  on public.rehab_patient;
drop policy if exists patient_claim     on public.rehab_patient;
drop policy if exists physio_sees_link  on public.rehab_patient;
drop policy if exists physio_reset_link on public.rehab_patient;
-- A patient sees their own claims.
create policy patient_own_read on public.rehab_patient for select to authenticated using (patient_id = (select auth.uid()));
-- Claiming needs the secret link (the key in the x-sync-key header). A key can be claimed once; there is no update policy.
create policy patient_claim on public.rehab_patient for insert to authenticated
  with check (patient_id = (select auth.uid()) and sync_key = public.request_sync_key());
-- The owning physio sees who claimed each of their patients, and can reset a claim (the patient then makes a new account).
create policy physio_sees_link on public.rehab_patient for select to authenticated
  using (exists (select 1 from public.rehab_owner o where o.sync_key = rehab_patient.sync_key and o.physio_id = (select auth.uid())));
create policy physio_reset_link on public.rehab_patient for delete to authenticated
  using (exists (select 1 from public.rehab_owner o where o.sync_key = rehab_patient.sync_key and o.physio_id = (select auth.uid())));

-- rehab_sync: the secret-link (anon) policies now stop applying once a patient account has claimed the key.
drop policy if exists patient_read   on public.rehab_sync;
drop policy if exists patient_insert on public.rehab_sync;
drop policy if exists patient_update on public.rehab_sync;
drop policy if exists link_read      on public.rehab_sync;
drop policy if exists link_insert    on public.rehab_sync;
drop policy if exists link_update    on public.rehab_sync;
drop policy if exists account_read   on public.rehab_sync;
drop policy if exists account_insert on public.rehab_sync;
drop policy if exists account_update on public.rehab_sync;

create policy link_read   on public.rehab_sync for select to anon
  using (sync_key = public.request_sync_key() and not public.rehab_key_has_patient(sync_key));
create policy link_insert on public.rehab_sync for insert to anon
  with check (sync_key = public.request_sync_key() and not public.rehab_key_has_patient(sync_key) and (slice = 'up' or not public.rehab_key_claimed(sync_key)));
create policy link_update on public.rehab_sync for update to anon
  using      (sync_key = public.request_sync_key() and not public.rehab_key_has_patient(sync_key) and (slice = 'up' or not public.rehab_key_claimed(sync_key)))
  with check (sync_key = public.request_sync_key() and not public.rehab_key_has_patient(sync_key) and (slice = 'up' or not public.rehab_key_claimed(sync_key)));

-- The patient's signed-in account: reads both slices of its own patients, writes only "up".
create policy account_read on public.rehab_sync for select to authenticated
  using (exists (select 1 from public.rehab_patient p where p.sync_key = rehab_sync.sync_key and p.patient_id = (select auth.uid())));
create policy account_insert on public.rehab_sync for insert to authenticated
  with check (slice = 'up' and exists (select 1 from public.rehab_patient p where p.sync_key = rehab_sync.sync_key and p.patient_id = (select auth.uid())));
create policy account_update on public.rehab_sync for update to authenticated
  using      (slice = 'up' and exists (select 1 from public.rehab_patient p where p.sync_key = rehab_sync.sync_key and p.patient_id = (select auth.uid())))
  with check (slice = 'up' and exists (select 1 from public.rehab_patient p where p.sync_key = rehab_sync.sync_key and p.patient_id = (select auth.uid())));
-- (the physio_* policies from schema-v2.sql are unchanged; still no delete policy on rehab_sync)
