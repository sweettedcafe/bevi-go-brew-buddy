-- =====================================================================
-- BEVI & GO — Phase 19
--   * Discounts: multiple items (applies_to_item_ids)
--   * Customer self-register: dedupe by email too + safer error path
--   * Customer lookup: also accept QR token / full URL
--   * Per-user page access (barista permission overrides)
--   * Developer-only bulk delete of orders
--   * Manila-timezone analytics RPC (peak / least hours)
--   * Realtime publication for orders + order_items
-- Run AFTER phase 18. Idempotent.
-- =====================================================================

-- 1) Discounts can target many items ----------------------------------
alter table public.discounts
  add column if not exists applies_to_item_ids uuid[] not null default '{}';

-- Backfill from legacy single-column (if present)
do $$
begin
  if exists(select 1 from information_schema.columns
            where table_schema='public' and table_name='discounts'
              and column_name='applies_to_item_id') then
    update public.discounts
       set applies_to_item_ids = array[applies_to_item_id]
     where applies_to_item_id is not null
       and (applies_to_item_ids is null or array_length(applies_to_item_ids,1) is null);
  end if;
end $$;

-- 2) Customer self-register: dedup by phone OR email ------------------
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
      return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',true,'matched_by','phone');
    end if;
  end if;
  if p_email is not null and trim(p_email) <> '' then
    select id, code, token into v_id, v_code, v_token
      from public.customers where lower(email) = lower(trim(p_email)) limit 1;
    if found then
      return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',true,'matched_by','email');
    end if;
  end if;

  v_code  := public._gen_customer_code();
  v_token := public._gen_customer_token();
  insert into public.customers(code, token, name, phone, email)
    values (v_code, v_token, trim(p_name), nullif(trim(p_phone),''), nullif(trim(p_email),''))
    returning id into v_id;
  return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',false);
exception when unique_violation then
  -- race / mixed dedupe — return best-effort existing record
  select id, code, token into v_id, v_code, v_token from public.customers
   where (p_phone is not null and phone = trim(p_phone))
      or (p_email is not null and lower(email) = lower(trim(p_email)))
   limit 1;
  return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',true,'matched_by','race');
end $$;
grant execute on function public.customer_self_register(text,text,text) to anon, authenticated;

-- 3) Customer lookup accepts code / id / token / full URL --------------
create or replace function public.customer_lookup(p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_c public.customers%rowtype;
  v_orders jsonb;
  v_top jsonb;
  v_key text;
begin
  if not public.is_staff(auth.uid()) then raise exception 'not authorized'; end if;

  v_key := trim(coalesce(p_code,''));
  -- strip prefix if a QR scan returned a URL like ".../o/<token>"
  if v_key ~* '^https?://' or v_key like '%/o/%' then
    v_key := regexp_replace(v_key, '^.*/o/', '');
    v_key := split_part(v_key, '?', 1);
    v_key := split_part(v_key, '#', 1);
  end if;

  select * into v_c from public.customers
    where (code = v_key or token = v_key or id::text = v_key) and is_active;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'order_no', order_no, 'created_at', created_at,
    'total', total, 'status', status
  ) order by created_at desc), '[]'::jsonb) into v_orders
  from (select * from public.orders where customer_id = v_c.id
        order by created_at desc limit 10) t;

  select coalesce(jsonb_agg(jsonb_build_object(
    'menu_item_id', menu_item_id, 'name', name, 'qty', qty_sum, 'last_at', last_at
  ) order by qty_sum desc), '[]'::jsonb) into v_top
  from (
    select oi.menu_item_id, max(oi.name_snapshot) as name,
           sum(oi.qty * case when coalesce(o.txn_kind,'sale') in ('void','refund') then -1 else 1 end) as qty_sum,
           max(o.created_at) as last_at
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.customer_id = v_c.id and oi.menu_item_id is not null
     group by oi.menu_item_id
     having sum(oi.qty * case when coalesce(o.txn_kind,'sale') in ('void','refund') then -1 else 1 end) > 0
     order by qty_sum desc limit 5
  ) t;

  return jsonb_build_object(
    'id', v_c.id, 'code', v_c.code, 'token', v_c.token,
    'name', v_c.name, 'phone', v_c.phone, 'email', v_c.email,
    'points', v_c.points, 'recent_orders', v_orders, 'top_items', v_top
  );
end $$;
grant execute on function public.customer_lookup(text) to authenticated;

-- 4) Per-user page access ---------------------------------------------
create table if not exists public.user_page_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  page text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, page)
);
grant select, insert, update, delete on public.user_page_access to authenticated;
grant all on public.user_page_access to service_role;
alter table public.user_page_access enable row level security;
drop policy if exists "upa staff read" on public.user_page_access;
create policy "upa staff read" on public.user_page_access
  for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists "upa admin write" on public.user_page_access;
create policy "upa admin write" on public.user_page_access
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

create or replace function public.staff_set_user_pages(p_user_id uuid, p_pages text[])
returns void language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not (public.has_role(v_actor,'admin') or public.has_role(v_actor,'developer')) then
    raise exception 'not authorized'; end if;
  delete from public.user_page_access where user_id = p_user_id;
  if p_pages is not null and array_length(p_pages,1) > 0 then
    insert into public.user_page_access(user_id, page)
      select p_user_id, unnest(p_pages)
      on conflict do nothing;
  end if;
end $$;
grant execute on function public.staff_set_user_pages(uuid, text[]) to authenticated;

create or replace function public.staff_get_user_pages(p_user_id uuid)
returns text[] language sql security definer set search_path=public as $$
  select coalesce(array_agg(page order by page), '{}')
  from public.user_page_access where user_id = p_user_id
$$;
grant execute on function public.staff_get_user_pages(uuid) to authenticated;

create or replace function public.my_page_access()
returns text[] language sql security definer set search_path=public as $$
  select coalesce(array_agg(page order by page), '{}')
  from public.user_page_access where user_id = auth.uid()
$$;
grant execute on function public.my_page_access() to authenticated;

-- 5) Developer-only delete of orders ----------------------------------
create or replace function public.dev_delete_orders(p_ids uuid[])
returns int language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid(); v_n int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.has_role(v_actor,'developer') then
    raise exception 'only developers may delete orders'; end if;
  if p_ids is null or array_length(p_ids,1) is null then return 0; end if;
  -- detach mirror parent links to avoid FK issues, then cascade order_items / payments
  update public.orders set parent_order_id = null where parent_order_id = any(p_ids);
  delete from public.order_items where order_id = any(p_ids);
  delete from public.order_payments where order_id = any(p_ids);
  delete from public.orders where id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.dev_delete_orders(uuid[]) to authenticated;

-- 6) Analytics RPC (Manila TZ) ----------------------------------------
create or replace function public.pos_analytics(
  p_from date,
  p_to date,
  p_owner_id uuid default null,
  p_category_id uuid default null,
  p_menu_item_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_tz text := 'Asia/Manila';
  v_from timestamptz := (p_from::timestamp) at time zone v_tz;
  v_to   timestamptz := ((p_to + 1)::timestamp) at time zone v_tz;
  v_hours jsonb; v_weekdays jsonb; v_daily jsonb; v_monthly jsonb;
  v_top_items jsonb; v_summary jsonb;
begin
  if not public.is_staff(auth.uid()) then raise exception 'not authorized'; end if;

  with base as (
    select o.id, o.created_at, oi.qty, oi.line_total,
           coalesce(o.txn_kind,'sale') as kind,
           mi.owner_id, mi.category_id, oi.menu_item_id, oi.name_snapshot
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      left join public.menu_items mi on mi.id = oi.menu_item_id
     where o.created_at >= v_from
       and o.created_at <  v_to
       and (p_owner_id is null    or mi.owner_id = p_owner_id)
       and (p_category_id is null or mi.category_id = p_category_id)
       and (p_menu_item_id is null or oi.menu_item_id = p_menu_item_id)
  ),
  signed as (
    select *,
      case when kind in ('void','refund') then -qty else qty end as sqty,
      case when kind in ('void','refund') then -line_total else line_total end as srev
    from base
  )
  select
    -- by hour-of-day 0..23
    coalesce((select jsonb_agg(jsonb_build_object('h', h, 'orders', orders, 'qty', qty, 'revenue', revenue) order by h)
        from (select extract(hour from (created_at at time zone v_tz))::int as h,
                     count(distinct id) as orders,
                     sum(sqty)::numeric as qty,
                     sum(srev)::numeric as revenue
                from signed group by 1) t), '[]'::jsonb),
    -- by weekday 0=Sun..6=Sat
    coalesce((select jsonb_agg(jsonb_build_object('d', d, 'orders', orders, 'qty', qty, 'revenue', revenue) order by d)
        from (select extract(dow from (created_at at time zone v_tz))::int as d,
                     count(distinct id) as orders,
                     sum(sqty)::numeric as qty,
                     sum(srev)::numeric as revenue
                from signed group by 1) t), '[]'::jsonb),
    -- daily
    coalesce((select jsonb_agg(jsonb_build_object('day', day, 'orders', orders, 'qty', qty, 'revenue', revenue) order by day)
        from (select (created_at at time zone v_tz)::date as day,
                     count(distinct id) as orders,
                     sum(sqty)::numeric as qty,
                     sum(srev)::numeric as revenue
                from signed group by 1) t), '[]'::jsonb),
    -- monthly
    coalesce((select jsonb_agg(jsonb_build_object('month', month, 'orders', orders, 'qty', qty, 'revenue', revenue) order by month)
        from (select to_char((created_at at time zone v_tz), 'YYYY-MM') as month,
                     count(distinct id) as orders,
                     sum(sqty)::numeric as qty,
                     sum(srev)::numeric as revenue
                from signed group by 1) t), '[]'::jsonb),
    -- top items
    coalesce((select jsonb_agg(jsonb_build_object('menu_item_id', menu_item_id, 'name', name, 'qty', qty, 'revenue', revenue) order by qty desc)
        from (select menu_item_id, max(name_snapshot) as name,
                     sum(sqty)::numeric as qty, sum(srev)::numeric as revenue
                from signed where menu_item_id is not null
               group by menu_item_id
               order by sum(sqty) desc nulls last
               limit 10) t), '[]'::jsonb),
    -- summary
    jsonb_build_object(
      'orders', coalesce((select count(distinct id) from signed), 0),
      'qty',    coalesce((select sum(sqty)::numeric from signed), 0),
      'revenue', coalesce((select sum(srev)::numeric from signed), 0),
      'tz', v_tz, 'from', p_from, 'to', p_to)
  into v_hours, v_weekdays, v_daily, v_monthly, v_top_items, v_summary;

  return jsonb_build_object(
    'summary', v_summary,
    'by_hour', v_hours,
    'by_weekday', v_weekdays,
    'by_day', v_daily,
    'by_month', v_monthly,
    'top_items', v_top_items
  );
end $$;
grant execute on function public.pos_analytics(date,date,uuid,uuid,uuid) to authenticated;

-- 7) Make sure realtime is publishing orders + order_items ------------
do $$
begin
  if not exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.order_items;
  exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
