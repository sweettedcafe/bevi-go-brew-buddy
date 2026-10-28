-- Phase 70: Partner gets edit access to Bundles (rest of Catalog + Discounts done in phases 67/68 and earlier)
drop policy if exists "bundles_admin_write" on public.bundles;
create policy "bundles_admin_write" on public.bundles
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'));

drop policy if exists "bundle_items_admin_write" on public.bundle_items;
create policy "bundle_items_admin_write" on public.bundle_items
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'));
