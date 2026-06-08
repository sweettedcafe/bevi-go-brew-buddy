-- =====================================================================
-- BEVI & GO — Phase 22
--   1) Bullet-proof order_no allocation (retry on unique_violation)
--   2) public_menu returns variants + new optional fields
-- All additive / idempotent.
-- =====================================================================

-- ---------- 1. Robust order_no allocator -----------------------------
-- Helper that hands out the next order number for a business date, using
-- a row-lock on the counter so concurrent calls never collide.
create or replace function public._alloc_order_no(p_date date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_seq int; v_max int;
begin
  -- ensure row exists & lock it
  insert into public.daily_order_counter(business_date, last_seq)
    values (p_date, 0)
    on conflict (business_date) do nothing;

  perform 1 from public.daily_order_counter where business_date = p_date for update;

  -- pick the larger of counter+1 or max(existing order_no)+1
  select coalesce(max(order_no), 0) into v_max
    from public.orders where business_date = p_date;

  update public.daily_order_counter
     set last_seq = greatest(last_seq, v_max) + 1
   where business_date = p_date
   returning last_seq into v_seq;

  return v_seq;
end $$;

grant execute on function public._alloc_order_no(date) to authenticated, anon;

-- ---------- 2. Patch customer_self_order to use the new allocator ----
create or replace function public.customer_self_order(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_c public.customers%rowtype;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_order_id uuid; v_order_no int;
  v_subtotal numeric(10,2) := 0;
  v_item jsonb; v_mi public.menu_items%rowtype;
  v_qty int; v_unit numeric(10,2); v_addon numeric(10,2); v_line numeric(10,2);
  v_attempts int := 0;
begin
  select * into v_c from public.customers where token = p_token and is_active;
  if not found then raise exception 'invalid customer token'; end if;

  loop
    v_attempts := v_attempts + 1;
    v_order_no := public._alloc_order_no(v_today);
    begin
      insert into public.orders(order_no, business_date, order_type, status,
        subtotal, tax, discount_total, total, customer_id, customer_name,
        notes, source, held_at)
      values (v_order_no, v_today,
        coalesce((p_payload->>'order_type')::public.order_type,'takeout'),
        'on_hold', 0,0,0,0,
        v_c.id, v_c.name, nullif(p_payload->>'notes',''),
        'self', now())
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      if v_attempts > 8 then raise; end if;
    end;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_qty   := coalesce((v_item->>'qty')::int,1);
    if v_qty <= 0 then continue; end if;
    select * into v_mi from public.menu_items where id = (v_item->>'menu_item_id')::uuid and is_active;
    if not found then raise exception 'menu item unavailable'; end if;
    v_addon := coalesce((v_item->>'addon_total')::numeric, 0);
    v_unit  := v_mi.price + v_addon;
    v_line  := round(v_unit * v_qty, 2);
    v_subtotal := v_subtotal + v_line;
    insert into public.order_items(order_id, menu_item_id, name_snapshot,
      unit_price, qty, line_total, notes, customization, addon_total)
    values (v_order_id, v_mi.id, v_mi.name, v_unit, v_qty, v_line,
      nullif(v_item->>'notes',''),
      coalesce(v_item->'customization','null'::jsonb),
      v_addon);
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_subtotal);
end $$;
grant execute on function public.customer_self_order(text, jsonb) to anon, authenticated;

-- ---------- 3. Public menu now includes variants & has_variants ------
create or replace function public.public_menu()
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'sort_order', c.sort_order
      ) order by c.sort_order) from public.categories c where c.is_active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'category_id', m.category_id, 'name', m.name,
        'description', m.description, 'price', m.price, 'options', m.options,
        'has_variants', m.has_variants
      ) order by m.sort_order) from public.menu_items m where m.is_active), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'menu_item_id', v.menu_item_id, 'name', v.name,
        'price', v.price, 'sort_order', v.sort_order
      ) order by v.sort_order) from public.menu_item_variants v where v.is_active), '[]'::jsonb)
  );
$$;
grant execute on function public.public_menu() to anon, authenticated;

notify pgrst, 'reload schema';
