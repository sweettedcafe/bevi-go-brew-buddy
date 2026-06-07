-- =====================================================================
-- BEVI & GO — Phase 17
-- Inventory: "Add packs" should only adjust CURRENT stock (stock_qty).
-- The full_stock_qty (capacity / target) must stay where the admin set it.
-- Run after phase 16. Safe to re-run.
-- =====================================================================

create or replace function public.inventory_add_packs(
  p_item_id uuid, p_packs numeric
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := auth.uid();
  v_it public.inventory_items%rowtype;
  v_added numeric;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not (public.has_role(v_actor,'admin') or public.has_role(v_actor,'developer')) then
    raise exception 'admin only';
  end if;
  if p_packs is null or p_packs <= 0 then
    raise exception 'packs must be > 0';
  end if;
  select * into v_it from public.inventory_items where id = p_item_id;
  if not found then raise exception 'inventory item not found'; end if;
  if coalesce(v_it.pack_size, 0) <= 0 then
    raise exception 'pack_size not configured for %', v_it.name;
  end if;

  v_added := p_packs * v_it.pack_size;

  -- Only the current stock auto-adjusts. full_stock_qty (capacity) is preserved.
  update public.inventory_items
     set stock_qty  = stock_qty + v_added,
         updated_at = now()
   where id = p_item_id;

  insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
    values (p_item_id, v_added, 'restock', 'inventory_add_packs', null, v_actor);

  return jsonb_build_object(
    'ok', true,
    'added_units', v_added,
    'packs', p_packs,
    'pack_size', v_it.pack_size
  );
end $$;

grant execute on function public.inventory_add_packs(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
