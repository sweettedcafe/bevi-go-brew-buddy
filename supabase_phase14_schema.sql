-- =====================================================================
-- BEVI & GO — Phase 14: Developer-only "wipe all orders" + helpers
-- Restocks inventory, reverses loyalty points, then hard-deletes all
-- orders / order_items / payments. Resets the order-number sequence.
-- DEVELOPER role ONLY. Run after phase 13.
-- =====================================================================

create or replace function public.dev_wipe_all_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_it record;
  v_r record;
  v_o record;
  v_orders int := 0;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.has_role(v_actor, 'developer') then
    raise exception 'only developers can wipe orders';
  end if;

  -- 1) Restock inventory for every non-voided/refunded order item
  for v_o in
    select id from public.orders
    where status not in ('voided','refunded')
  loop
    for v_it in
      select menu_item_id, qty from public.order_items where order_id = v_o.id
    loop
      for v_r in
        select inventory_item_id, qty_per_unit
        from public.recipes where menu_item_id = v_it.menu_item_id
      loop
        update public.inventory_items
           set stock_qty = stock_qty + (v_r.qty_per_unit * v_it.qty),
               updated_at = now()
         where id = v_r.inventory_item_id;
      end loop;
    end loop;
    v_orders := v_orders + 1;
  end loop;

  -- 2) Reverse loyalty: subtract earned, re-credit redeemed
  update public.customers c
     set points = greatest(0, c.points - coalesce(o.earned, 0)) + coalesce(o.redeemed, 0),
         updated_at = now()
    from (
      select customer_id,
             sum(coalesce(points_earned, 0))   as earned,
             sum(coalesce(points_redeemed, 0)) as redeemed
        from public.orders
       where customer_id is not null
         and status not in ('voided','refunded')
       group by customer_id
    ) o
   where c.id = o.customer_id;

  -- 3) Hard delete dependent rows then orders
  delete from public.inventory_movements where ref_table = 'orders';
  delete from public.payments;
  delete from public.order_items;
  delete from public.orders;

  -- 4) Reset order number sequence (if present) back to 1
  perform setval(pg_get_serial_sequence('public.orders', 'order_no'), 1, false)
    where pg_get_serial_sequence('public.orders', 'order_no') is not null;

  return jsonb_build_object('ok', true, 'deleted_orders', v_orders);
end
$$;

revoke all on function public.dev_wipe_all_orders() from public, anon, authenticated;
grant execute on function public.dev_wipe_all_orders() to authenticated;

notify pgrst, 'reload schema';
