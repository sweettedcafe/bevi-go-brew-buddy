-- =====================================================================
-- BEVI & GO — Phase 31: Fix dev_wipe_all_orders + add reset RPCs
-- for inventory, menu, recipes. DEVELOPER role ONLY.
-- =====================================================================

-- ---------- 1. Fix dev_wipe_all_orders --------------------------------
-- Correct table name is order_payments (not payments). Also clear
-- upsell_events and daily_order_counter so numbering restarts cleanly.
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

  -- 2) Reverse loyalty
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
  begin
    delete from public.upsell_events;
  exception when undefined_table then null;
  end;
  delete from public.order_payments;
  delete from public.order_items;
  delete from public.orders;

  -- 4) Reset daily order counter
  begin
    delete from public.daily_order_counter;
  exception when undefined_table then null;
  end;

  return jsonb_build_object('ok', true, 'deleted_orders', v_orders);
end
$$;

revoke all on function public.dev_wipe_all_orders() from public, anon, authenticated;
grant execute on function public.dev_wipe_all_orders() to authenticated;

-- ---------- 2. Reset inventory ----------------------------------------
-- Wipes all inventory items, their movements, and any recipe rows that
-- depend on them. Menu items remain but will have no recipes attached.
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

  -- recipes reference inventory_items — drop them first
  begin delete from public.variant_recipes; exception when undefined_table then null; end;
  delete from public.recipes;
  delete from public.inventory_movements;
  delete from public.inventory_items;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_inventory_items', v_count);
end
$$;
revoke all on function public.dev_reset_inventory() from public, anon, authenticated;
grant execute on function public.dev_reset_inventory() to authenticated;

-- ---------- 3. Reset menu (items, variants, bundles, categories) ------
-- Requires orders to be wiped first (order_items FK). Also drops recipes
-- that reference menu items.
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

  begin delete from public.variant_recipes; exception when undefined_table then null; end;
  delete from public.recipes;
  begin delete from public.bundle_items;    exception when undefined_table then null; end;
  begin delete from public.bundles;         exception when undefined_table then null; end;
  begin delete from public.menu_item_variants; exception when undefined_table then null; end;
  delete from public.menu_items;
  get diagnostics v_count = row_count;
  begin delete from public.categories;      exception when undefined_table then null; end;

  return jsonb_build_object('ok', true, 'deleted_menu_items', v_count);
end
$$;
revoke all on function public.dev_reset_menu() from public, anon, authenticated;
grant execute on function public.dev_reset_menu() to authenticated;

-- ---------- 4. Reset recipes only -------------------------------------
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

  begin delete from public.variant_recipes; exception when undefined_table then null; end;
  delete from public.recipes;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_recipes', v_count);
end
$$;
revoke all on function public.dev_reset_recipes() from public, anon, authenticated;
grant execute on function public.dev_reset_recipes() to authenticated;

notify pgrst, 'reload schema';
