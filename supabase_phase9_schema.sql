-- =====================================================================
-- BEVI & GO — Phase 9: Reports, Refund/Void, Staff-by-Email, Sheets sync
-- Run AFTER phases 1–8. Idempotent.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- 1. Force-refresh customer_self_register (PostgREST cache) -
-- Also (re)create the helper fns in case phase 8 didn't run cleanly.
create or replace function public._gen_customer_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_tries int := 0;
begin
  loop
    v_code := lpad((floor(random()*100000000))::int::text, 8, '0');
    exit when not exists(select 1 from public.customers where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then raise exception 'cannot generate unique customer code'; end if;
  end loop;
  return v_code;
end $$;

create or replace function public._gen_customer_token()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  v_token := encode(gen_random_bytes(18), 'base64');
  v_token := replace(replace(replace(v_token, '+',''), '/',''), '=','');
  return left(v_token, 22);
end $$;

drop function if exists public.customer_self_register(text, text, text);
create or replace function public.customer_self_register(
  p_name text, p_phone text default null, p_email text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; v_token text;
begin
  if coalesce(trim(p_name),'') = '' then raise exception 'name required'; end if;
  if p_phone is not null and trim(p_phone) <> '' then
    select id, code, token into v_id, v_code, v_token
    from public.customers where phone = trim(p_phone) limit 1;
    if found then
      return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',true);
    end if;
  end if;
  v_code  := public._gen_customer_code();
  v_token := public._gen_customer_token();
  insert into public.customers(code, token, name, phone, email)
    values (v_code, v_token, trim(p_name), nullif(trim(p_phone),''), nullif(trim(p_email),''))
    returning id into v_id;
  return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',false);
end $$;
grant execute on function public.customer_self_register(text,text,text) to anon, authenticated;
notify pgrst, 'reload schema';

-- ---------- 2. STAFF management RPCs (assign by email) ---------------
-- Returns {user_id, email, role} list. Joins auth.users (security definer).
create or replace function public.staff_list_assignments()
returns table(user_id uuid, email text, role public.app_role, created_at timestamptz)
language sql security definer set search_path = public, auth as $$
  select ur.user_id, u.email::text, ur.role, ur.created_at
  from public.user_roles ur
  join auth.users u on u.id = ur.user_id
  where public.is_staff(auth.uid())
  order by ur.created_at desc
$$;
grant execute on function public.staff_list_assignments() to authenticated;

create or replace function public.assign_role_by_email(p_email text, p_role public.app_role)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid; v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not (public.has_role(v_actor,'admin') or public.has_role(v_actor,'developer')) then
    raise exception 'not authorized';
  end if;
  if p_role = 'developer' and not public.has_role(v_actor,'developer') then
    raise exception 'only developers can assign developer';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_uid is null then
    raise exception 'No account with that email. Ask them to sign up first.';
  end if;
  insert into public.user_roles(user_id, role) values (v_uid, p_role)
    on conflict (user_id, role) do nothing;
  return jsonb_build_object('user_id', v_uid, 'email', p_email, 'role', p_role);
end $$;
grant execute on function public.assign_role_by_email(text, public.app_role) to authenticated;

create or replace function public.remove_role_assignment(p_user_id uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not (public.has_role(v_actor,'admin') or public.has_role(v_actor,'developer')) then
    raise exception 'not authorized';
  end if;
  if p_role = 'developer' and not public.has_role(v_actor,'developer') then
    raise exception 'only developers can remove developer'; end if;
  delete from public.user_roles where user_id = p_user_id and role = p_role;
end $$;
grant execute on function public.remove_role_assignment(uuid, public.app_role) to authenticated;

-- For Reports → show cashier email instead of UUID.
create or replace function public.staff_emails()
returns table(user_id uuid, email text)
language sql security definer set search_path = public, auth as $$
  select distinct ur.user_id, u.email::text
  from public.user_roles ur join auth.users u on u.id = ur.user_id
  where public.is_staff(auth.uid())
$$;
grant execute on function public.staff_emails() to authenticated;

-- ---------- 3. REFUND / VOID RPCs ------------------------------------
-- Restock inventory + reverse loyalty + set status.
create or replace function public._reverse_order(p_order_id uuid, p_new_status public.order_status)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_o public.orders%rowtype;
  v_it record; v_r record;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not (public.has_role(v_actor,'admin') or public.has_role(v_actor,'developer')) then
    raise exception 'only admins can refund or void';
  end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_o.status in ('voided','refunded') then
    raise exception 'order already %', v_o.status;
  end if;

  -- restock inventory using recipes
  for v_it in select menu_item_id, qty from public.order_items where order_id = p_order_id loop
    for v_r in select inventory_item_id, qty_per_unit from public.recipes where menu_item_id = v_it.menu_item_id loop
      update public.inventory_items
         set stock_qty = stock_qty + (v_r.qty_per_unit * v_it.qty), updated_at = now()
       where id = v_r.inventory_item_id;
      insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
        values (v_r.inventory_item_id, (v_r.qty_per_unit * v_it.qty),
                p_new_status::text, 'orders', p_order_id::text, v_actor);
    end loop;
  end loop;

  -- reverse loyalty: subtract earned, re-credit redeemed
  if v_o.customer_id is not null then
    update public.customers
       set points = greatest(0, points - coalesce(v_o.points_earned,0)) + coalesce(v_o.points_redeemed,0),
           updated_at = now()
     where id = v_o.customer_id;
  end if;

  update public.orders
     set status = p_new_status,
         notes = coalesce(notes,'') || E'\n['||p_new_status::text||' by '||v_actor::text||' at '||now()::text||']'
   where id = p_order_id;

  return jsonb_build_object('order_id', p_order_id, 'status', p_new_status);
end $$;

create or replace function public.pos_refund_order(p_order_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  select public._reverse_order(p_order_id, 'refunded'::public.order_status);
$$;
create or replace function public.pos_void_order(p_order_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  select public._reverse_order(p_order_id, 'voided'::public.order_status);
$$;
grant execute on function public.pos_refund_order(uuid) to authenticated;
grant execute on function public.pos_void_order(uuid)   to authenticated;

-- ---------- 4. INTEGRATION SETTINGS (Google Sheets) ------------------
create table if not exists public.integration_settings (
  id int primary key default 1,
  sheets_enabled boolean not null default false,
  sheets_spreadsheet_id text,
  sheets_sheet_name text default 'Orders',
  updated_at timestamptz not null default now(),
  constraint integration_settings_singleton check (id = 1)
);
insert into public.integration_settings(id) values(1) on conflict (id) do nothing;
alter table public.integration_settings enable row level security;
grant select on public.integration_settings to authenticated;
grant update on public.integration_settings to authenticated;
grant all on public.integration_settings to service_role;
drop policy if exists "is staff read" on public.integration_settings;
drop policy if exists "is admin write" on public.integration_settings;
create policy "is staff read" on public.integration_settings
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "is admin write" on public.integration_settings
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

notify pgrst, 'reload schema';
