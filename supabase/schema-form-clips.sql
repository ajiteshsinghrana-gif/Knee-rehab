-- Form-check video clips (patient -> physio). Run ONCE in the Supabase SQL editor, AFTER schema-v3.sql and schema-v4.sql. Safe to run again.
--
-- UNTESTED against a live project when this file was written. Test in a STAGING project first (README, "Video requests").
-- The one thing to verify: that public.request_sync_key() (which reads the x-sync-key request header) works on Storage requests.
-- If it does not, uploads from link-only patients will be refused (403). The fallback is an upload through an edge function.
--
-- What it adds
--   * A PRIVATE bucket "form-clips": no public read. 25 MB per file; MP4, WebM and MOV only.
--   * Folder name = the patient's sync key; file name = the request id.
--   * Patient upload and delete: only inside their own folder (by the x-sync-key header, or their own signed-in account).
--   * Physio read and delete: only for patients the physio owns (rehab_owner).
--   * Deletion on schedule is done by the app (clip.deleteAfter); a nightly job can also sweep. These are clinical-adjacent videos:
--     keep the retention short and confirm it with your physio and your lawyer.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('form-clips', 'form-clips', false, 26214400, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists form_clips_patient_insert on storage.objects;
drop policy if exists form_clips_patient_delete on storage.objects;
drop policy if exists form_clips_physio_select on storage.objects;
drop policy if exists form_clips_physio_delete on storage.objects;

-- Patient on the secret link (no login): the folder must equal the key in the x-sync-key header.
create policy form_clips_patient_insert on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'form-clips'
    and (storage.foldername(name))[1] = public.request_sync_key()
    and (
      -- the patient has no account claimed, or is the claimed account
      not public.rehab_key_has_patient((storage.foldername(name))[1])
      or exists (select 1 from public.rehab_patient p where p.sync_key = (storage.foldername(name))[1] and p.patient_id = (select auth.uid()))
    )
  );

create policy form_clips_patient_delete on storage.objects for delete to anon, authenticated
  using (
    bucket_id = 'form-clips'
    and (storage.foldername(name))[1] = public.request_sync_key()
    and (
      not public.rehab_key_has_patient((storage.foldername(name))[1])
      or exists (select 1 from public.rehab_patient p where p.sync_key = (storage.foldername(name))[1] and p.patient_id = (select auth.uid()))
    )
  );

-- Physio: read (signed address) and delete clips of their own patients.
create policy form_clips_physio_select on storage.objects for select to authenticated
  using (
    bucket_id = 'form-clips'
    and exists (select 1 from public.rehab_owner o where o.sync_key = (storage.foldername(name))[1] and o.physio_id = (select auth.uid()))
  );
create policy form_clips_physio_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'form-clips'
    and exists (select 1 from public.rehab_owner o where o.sync_key = (storage.foldername(name))[1] and o.physio_id = (select auth.uid()))
  );
