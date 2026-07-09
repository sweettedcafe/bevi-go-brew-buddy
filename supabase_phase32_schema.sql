-- =====================================================================
-- BEVI & GO — Phase 32: safe-delete fix for developer reset RPCs
-- Adds explicit WHERE clauses to all destructive developer deletes so
-- database safe-update protection allows the wipe/reset functions.
-- Run after phase 31.
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

  delete from public.inventory_movements where ref_table = 'orders';
  begin
    delete from public.upsell_events where true;
  exception when undefined_table then null;
  end;
  delete from public.order_payments where true;
  delete from public.order_items where true;
  delete from public.orders where true;

  begin
    delete from public.daily_order_counter where true;
  exception when undefined_table then null;
  end;

  return jsonb_build_object('ok', true, 'deleted_orders', v_orders);
end
$$;
revoke all on function public.dev_wipe_all_orders() from public, anon, authenticated;
grant execute on function public.dev_wipe_all_orders() to authenticated;

create or replace function public.dev_reset_inventory()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.has_role(v_actor, 'developer') then
    raise exception 'only developers can reset inventory';
  end if;

  begin delete from public.variant_recipes where true; exception when undefined_table then null; end;
  delete from public.recipes where true;
  delete from public.inventory_movements where true;
  delete from public.inventory_items where true;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_inventory_items', v_count);
end
$$;
revoke all on function public.dev_reset_inventory() from public, anon, authenticated;
grant execute on function public.dev_reset_inventory() to authenticated;

create or replace function public.dev_reset_menu()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.has_role(v_actor, 'developer') then
    raise exception 'only developers can reset the menu';
  end if;

  if exists (select 1 from public.orders limit 1) then
    raise exception 'wipe orders first — menu items are referenced by order history';
  end if;

  begin delete from public.variant_recipes where true; exception when undefined_table then null; end;
  delete from public.recipes where true;
  begin delete from public.bundle_items where true; exception when undefined_table then null; end;
  begin delete from public.bundles where true; exception when undefined_table then null; end;
  begin delete from public.menu_item_variants where true; exception when undefined_table then null; end;
  delete from public.menu_items where true;
  get diagnostics v_count = row_count;
  begin delete from public.categories where true; exception when undefined_table then null; end;

  return jsonb_build_object('ok', true, 'deleted_menu_items', v_count);
end
$$;
revoke all on function public.dev_reset_menu() from public, anon, authenticated;
grant execute on function public.dev_reset_menu() to authenticated;

create or replace function public.dev_reset_recipes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.has_role(v_actor, 'developer') then
    raise exception 'only developers can reset recipes';
  end if;

  begin delete from public.variant_recipes where true; exception when undefined_table then null; end;
  delete from public.recipes where true;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_recipes', v_count);
end
$$;
revoke all on function public.dev_reset_recipes() from public, anon, authenticated;
grant execute on function public.dev_reset_recipes() to authenticated;

notify pgrst, 'reload schema';