-- Phase 6.4: erasing a patient, a claim PIN, and account deletion. Run ONCE in the Supabase SQL editor, AFTER schema.sql, schema-v2.sql
-- and schema-v3.sql. Safe to run again.
--
-- What it adds
--   * The owning physio can DELETE a patient's rows (rehab_sync, rehab_patient already, rehab_owner). Nobody else can delete anything.
--   * A claim PIN. The physio stores only a SHA-256 hash of an 8-digit PIN (rehab_owner.claim_hash). When a patient account claims a
--     link, a trigger checks the PIN they typed against that hash and then throws the PIN away. A link with no PIN set works as before.
--   * rehab_delete_my_account(): a patient deletes their own login. The clinical record stays with the clinic (it may have to be kept
--     under medical-record rules); only the physio erases that.

-- 1. Ownership: PIN hash, and the owner may update or delete their own rows.
alter table public.rehab_owner add column if not exists claim_hash text check (claim_hash is null or claim_hash ~ '^[0-9a-f]{64}$');
drop policy if exists owner_update on public.rehab_owner;
drop policy if exists owner_delete on public.rehab_owner;
create policy owner_update on public.rehab_owner for update to authenticated
  using (physio_id = (select auth.uid())) with check (physio_id = (select auth.uid()));
create policy owner_delete on public.rehab_owner for delete to authenticated
  using (physio_id = (select auth.uid()));

-- 2. The owning physio may erase a patient's answers and plan.
drop policy if exists physio_erase on public.rehab_sync;
create policy physio_erase on public.rehab_sync for delete to authenticated
  using (exists (select 1 from public.rehab_owner o where o.sync_key = rehab_sync.sync_key and o.physio_id = (select auth.uid())));

-- 3. Claim PIN, checked in a trigger so the PIN never needs to be stored.
alter table public.rehab_patient add column if not exists pin text;
create or replace function public.rehab_check_pin() returns trigger
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  select o.claim_hash into h from public.rehab_owner o where o.sync_key = new.sync_key;
  if h is not null and (new.pin is null or encode(sha256(convert_to(new.pin, 'UTF8')), 'hex') <> h) then
    raise exception 'claim PIN required or wrong' using errcode = '42501';
  end if;
  new.pin := null;
  return new;
end $$;
revoke all on function public.rehab_check_pin() from public;
drop trigger if exists rehab_patient_pin on public.rehab_patient;
create trigger rehab_patient_pin before insert on public.rehab_patient for each row execute function public.rehab_check_pin();

-- 4. A patient deletes their own login (not the clinic's record).
create or replace function public.rehab_delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.rehab_patient where patient_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.rehab_delete_my_account() from public, anon;
grant execute on function public.rehab_delete_my_account() to authenticated;
