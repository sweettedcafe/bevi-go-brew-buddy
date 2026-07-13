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

-- 1b) Customer ordering menu must include the image_url ------------------
-- The customer page reads menu data from public_menu(), not directly from
-- menu_items. Keep the latest public_menu shape and add image_url to items.
create or replace function public.public_menu()
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'sort_order', c.sort_order
      ) order by c.sort_order) from public.categories c where c.is_active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'category_id', m.category_id, 'name', m.name,
        'description', m.description, 'price', m.price, 'options', m.options,
        'has_variants', m.has_variants, 'image_url', m.image_url
      ) order by m.sort_order) from public.menu_items m where m.is_active), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'menu_item_id', v.menu_item_id, 'name', v.name,
        'price', v.price, 'sort_order', v.sort_order
      ) order by v.sort_order) from public.menu_item_variants v where v.is_active), '[]'::jsonb),
    'bundles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'description', b.description, 'price', b.price
      )) from public.bundles b
      where b.is_active
        and (b.starts_at is null or b.starts_at <= now())
        and (b.ends_at   is null or b.ends_at   >  now())), '[]'::jsonb),
    'bundle_items', coalesce((select jsonb_agg(jsonb_build_object(
        'bundle_id', bi.bundle_id, 'menu_item_id', bi.menu_item_id, 'qty', bi.qty,
        'discount_type', bi.discount_type, 'discount_value', bi.discount_value
      )) from public.bundle_items bi
      where exists (select 1 from public.bundles b
                    where b.id = bi.bundle_id and b.is_active)), '[]'::jsonb)
  );
$$;
grant execute on function public.public_menu() to anon, authenticated;

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

notify pgrst, 'reload schema';

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
