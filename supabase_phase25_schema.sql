-- =====================================================================
-- BEVI & GO — Phase 25
-- Creates the `expense-receipts` public storage bucket + object policies.
-- Idempotent; run in Supabase SQL editor. This fixes the
-- "Bucket not found" error when uploading expense receipts.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', true)
on conflict (id) do update set public = true;

-- Allow authenticated staff to upload
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bevi expense receipts upload'
  ) then
    create policy "bevi expense receipts upload" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'expense-receipts');
  end if;
end $$;

-- Allow anyone to read (public bucket)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bevi expense receipts read'
  ) then
    create policy "bevi expense receipts read" on storage.objects
      for select using (bucket_id = 'expense-receipts');
  end if;
end $$;

-- Allow staff to update (e.g. replace file for same expense)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bevi expense receipts update'
  ) then
    create policy "bevi expense receipts update" on storage.objects
      for update to authenticated
      using (bucket_id = 'expense-receipts');
  end if;
end $$;
