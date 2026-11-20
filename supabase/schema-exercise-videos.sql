-- Exercise demonstration videos (Phase 7.2). Run this ONCE in the Supabase SQL editor, AFTER schema-v3.sql. Safe to run again.
--
-- What it adds
--   * A storage bucket "exercise-demos": public read, so a patient's phone can play a video without an account.
--     Files are named with a random 128-bit value, so an address cannot be guessed. Only MP4, WebM and MOV, up to 50 MB.
--   * Upload: any signed-in user who is NOT a patient account (that is, a physio).
--   * Delete: only the account that uploaded the file.
-- These are teaching videos of the physio demonstrating an exercise. Never upload a video of a patient.
-- Note: the free plan limits one upload to 50 MB; raising file_size_limit here does not lift the plan's own cap.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-demos', 'exercise-demos', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists exercise_demos_upload on storage.objects;
drop policy if exists exercise_demos_delete on storage.objects;

-- Physios only: a patient account (rehab_patient, schema-v3) cannot upload.
create policy exercise_demos_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'exercise-demos'
    and not exists (select 1 from public.rehab_patient p where p.patient_id = (select auth.uid()))
  );

-- Only the uploader can remove a file.
create policy exercise_demos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'exercise-demos' and owner_id = (select auth.uid())::text);

-- Reading needs no policy: the bucket is public, so its files are served by address.
