-- Phase 66: Loyalty visibility for baristas + reset all points
alter table public.loyalty_settings
  add column if not exists show_to_barista boolean not null default true;

-- Partner can also edit loyalty settings
drop policy if exists "loy admin write" on public.loyalty_settings;
create policy "loy admin write" on public.loyalty_settings
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'));

-- Reset every customer's points to zero (admin / developer / partner only)
create or replace function public.loyalty_reset_all_points()
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
          or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner')) then
    raise exception 'Not allowed';
  end if;
  update public.customers set points = 0 where points <> 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.loyalty_reset_all_points() from public, anon;
grant execute on function public.loyalty_reset_all_points() to authenticated;
