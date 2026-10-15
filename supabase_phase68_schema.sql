-- Phase 68: Partner can create/edit/delete Discounts & Promo Codes
drop policy if exists "dsc admin write" on public.discounts;
create policy "dsc admin write" on public.discounts
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'));
