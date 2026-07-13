-- =====================================================================
-- BEVI & GO — Phase 36
-- Adds per-item product images for the customer ordering page.
--   * menu_items.image_url column
--   * Public storage bucket `menu-images` with staff-write / public-read
-- Idempotent; safe to re-run.
-- =====================================================================

-- 1) Column on menu_items -----------------------------------------------
alter table public.menu_items
  add column if not exists image_url text;

-- 2) Public bucket for menu item photos ---------------------------------
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do update set public = true;

-- Upload (admins/developers/baristas — any signed-in staff)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bevi menu images upload'
  ) then
    create policy "bevi menu images upload" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'menu-images');
  end if;
end $$;

-- Public read (customers on the ordering page are anonymous)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bevi menu images read'
  ) then
    create policy "bevi menu images read" on storage.objects
      for select using (bucket_id = 'menu-images');
  end if;
end $$;

-- Update / replace
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bevi menu images update'
  ) then
    create policy "bevi menu images update" on storage.objects
      for update to authenticated
      using (bucket_id = 'menu-images');
  end if;
end $$;

-- Delete (when admin removes/replaces an image)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='bevi menu images delete'
  ) then
    create policy "bevi menu images delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'menu-images');
  end if;
end $$;
