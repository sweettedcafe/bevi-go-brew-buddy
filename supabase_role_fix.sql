-- =====================================================================
-- BEVI & GO — Role visibility + permissions fix
-- Run this in the SQL editor of project: ewwtxzoruibaxalffyli
-- Purpose:
--   1) Ensure user_roles is reachable through the API
--   2) Recreate the self-read / staff-read RLS policies
--   3) Assign developer + admin to baitjay25@gmail.com
-- =====================================================================

grant usage on schema public to authenticated;
grant usage on schema public to service_role;

grant select, insert, update, delete on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to service_role;
grant execute on function public.is_staff(uuid) to authenticated;
grant execute on function public.is_staff(uuid) to service_role;

alter table public.user_roles enable row level security;

drop policy if exists "user_roles self read" on public.user_roles;
drop policy if exists "user_roles staff read" on public.user_roles;
drop policy if exists "user_roles dev manage" on public.user_roles;
drop policy if exists "user_roles admin manage" on public.user_roles;

create policy "user_roles self read" on public.user_roles
  for select to authenticated using (user_id = auth.uid());

create policy "user_roles staff read" on public.user_roles
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'));

create policy "user_roles dev manage" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(), 'developer'))
  with check (public.has_role(auth.uid(), 'developer'));

create policy "user_roles admin manage" on public.user_roles
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and role <> 'developer');

insert into public.user_roles (user_id, role)
select u.id, v.role
from auth.users u
cross join (
  values
    ('developer'::public.app_role),
    ('admin'::public.app_role)
) as v(role)
where lower(u.email) = lower('baitjay25@gmail.com')
on conflict (user_id, role) do nothing;

select u.id, u.email, ur.role
from public.user_roles ur
join auth.users u on u.id = ur.user_id
where lower(u.email) = lower('baitjay25@gmail.com')
order by ur.role;