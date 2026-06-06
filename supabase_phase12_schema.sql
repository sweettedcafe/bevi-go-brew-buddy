-- Phase 12: Bundles + item-scoped discounts
-- Run in Supabase SQL editor.

-- 1. Bundles ----------------------------------------------------------------
create table if not exists public.bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.bundles to authenticated;
grant all on public.bundles to service_role;

alter table public.bundles enable row level security;

drop policy if exists "bundles_select_all" on public.bundles;
create policy "bundles_select_all" on public.bundles
  for select to authenticated using (true);

drop policy if exists "bundles_admin_write" on public.bundles;
create policy "bundles_admin_write" on public.bundles
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'));

-- 2. Bundle items -----------------------------------------------------------
create table if not exists public.bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  qty integer not null default 1 check (qty > 0)
);

grant select, insert, update, delete on public.bundle_items to authenticated;
grant all on public.bundle_items to service_role;

alter table public.bundle_items enable row level security;

drop policy if exists "bundle_items_select_all" on public.bundle_items;
create policy "bundle_items_select_all" on public.bundle_items
  for select to authenticated using (true);

drop policy if exists "bundle_items_admin_write" on public.bundle_items;
create policy "bundle_items_admin_write" on public.bundle_items
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'));

-- 3. Item-scoped discounts --------------------------------------------------
alter table public.discounts
  add column if not exists applies_to_item_id uuid references public.menu_items(id) on delete set null;
