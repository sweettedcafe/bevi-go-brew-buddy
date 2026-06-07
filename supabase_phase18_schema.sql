-- Phase 18: bundle per-item discounts, owner display, customer top items
-- Run in the Supabase SQL editor.

-- 1) Per-item discount on bundle components ---------------------------------
alter table public.bundle_items
  add column if not exists discount_type text
    check (discount_type in ('percent','fixed')) default 'percent',
  add column if not exists discount_value numeric(10,2) not null default 0
    check (discount_value >= 0);

-- 2) Customer lookup with top items -----------------------------------------
create or replace function public.customer_lookup(p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_c public.customers%rowtype;
  v_orders jsonb;
  v_top jsonb;
begin
  if not public.is_staff(auth.uid()) then raise exception 'not authorized'; end if;
  select * into v_c from public.customers
    where (code = trim(p_code) or id::text = trim(p_code)) and is_active;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'order_no', order_no, 'created_at', created_at,
    'total', total, 'status', status
  ) order by created_at desc), '[]'::jsonb) into v_orders
  from (select * from public.orders where customer_id = v_c.id
        order by created_at desc limit 10) t;

  -- top 5 most-ordered items for this customer (signed qty so voids/refunds reduce)
  select coalesce(jsonb_agg(jsonb_build_object(
    'menu_item_id', menu_item_id,
    'name', name,
    'qty', qty_sum,
    'last_at', last_at
  ) order by qty_sum desc), '[]'::jsonb) into v_top
  from (
    select oi.menu_item_id,
           max(oi.name) as name,
           sum(oi.qty * case when coalesce(o.txn_kind,'sale') in ('void','refund') then -1 else 1 end) as qty_sum,
           max(o.created_at) as last_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.customer_id = v_c.id
      and oi.menu_item_id is not null
    group by oi.menu_item_id
    having sum(oi.qty * case when coalesce(o.txn_kind,'sale') in ('void','refund') then -1 else 1 end) > 0
    order by qty_sum desc
    limit 5
  ) t;

  return jsonb_build_object(
    'id', v_c.id, 'code', v_c.code, 'token', v_c.token,
    'name', v_c.name, 'phone', v_c.phone, 'email', v_c.email,
    'points', v_c.points, 'recent_orders', v_orders,
    'top_items', v_top
  );
end $$;
grant execute on function public.customer_lookup(text) to authenticated;
