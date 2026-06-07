-- Phase 21: Soft-delete customers (admin) with developer restore.

alter table public.customers
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists customers_deleted_at_idx on public.customers (deleted_at);

-- Admin (or developer) can soft-delete
create or replace function public.admin_delete_customer(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')) then
    raise exception 'forbidden';
  end if;
  update public.customers
    set deleted_at = now(), deleted_by = auth.uid(), is_active = false
    where id = p_id and deleted_at is null;
end $$;

-- Developer-only restore
create or replace function public.dev_restore_customer(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'developer') then
    raise exception 'developer only';
  end if;
  update public.customers
    set deleted_at = null, deleted_by = null, is_active = true
    where id = p_id;
end $$;

-- Developer-only list of deleted customers
create or replace function public.dev_list_deleted_customers()
returns setof public.customers
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'developer') then
    raise exception 'developer only';
  end if;
  return query
    select * from public.customers where deleted_at is not null
    order by deleted_at desc;
end $$;

grant execute on function public.admin_delete_customer(uuid) to authenticated;
grant execute on function public.dev_restore_customer(uuid) to authenticated;
grant execute on function public.dev_list_deleted_customers() to authenticated;
