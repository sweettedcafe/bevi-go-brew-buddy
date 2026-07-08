-- =====================================================================
-- BEVI & GO — Phase 23
--   1) public_menu now also returns bundles + bundle_items
--   2) customer_self_order accepts { bundles: [{bundle_id, qty}] } too
--   3) customer_order_status(p_token, p_order_id) for order-ready polling
-- Idempotent; run after phase 22.
-- =====================================================================

-- ---------- 1. public_menu: add bundles ------------------------------
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
      ) order by v.sort_order) from public.menu_item_variants v where v.is_active), '[]'::jsonb),
    'bundles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'description', b.description, 'price', b.price
      )) from public.bundles b
      where b.is_active
        and (b.starts_at is null or b.starts_at <= now())
        and (b.ends_at   is null or b.ends_at   >  now())), '[]'::jsonb),
    'bundle_items', coalesce((select jsonb_agg(jsonb_build_object(
        'bundle_id', bi.bundle_id, 'menu_item_id', bi.menu_item_id, 'qty', bi.qty,
        'discount_type', bi.discount_type, 'discount_value', bi.discount_value
      )) from public.bundle_items bi
      where exists (select 1 from public.bundles b
                    where b.id = bi.bundle_id and b.is_active)), '[]'::jsonb)
  );
$$;
grant execute on function public.public_menu() to anon, authenticated;

-- ---------- 2. customer_self_order: accept bundles too ---------------
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
  v_bundle jsonb; v_b public.bundles%rowtype; v_bi record;
  v_bqty int; v_bprice numeric(10,2);
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

  -- normal items
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_qty := coalesce((v_item->>'qty')::int,1);
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

  -- bundles: expand each into discounted lines
  for v_bundle in select * from jsonb_array_elements(coalesce(p_payload->'bundles','[]'::jsonb)) loop
    v_bqty := coalesce((v_bundle->>'qty')::int, 1);
    if v_bqty <= 0 then continue; end if;
    select * into v_b from public.bundles where id = (v_bundle->>'bundle_id')::uuid and is_active;
    if not found then raise exception 'bundle unavailable'; end if;
    for v_bi in
      select bi.menu_item_id, bi.qty, bi.discount_type, bi.discount_value, mi.name, mi.price
        from public.bundle_items bi
        join public.menu_items mi on mi.id = bi.menu_item_id and mi.is_active
       where bi.bundle_id = v_b.id
    loop
      v_bprice := case
        when v_bi.discount_type = 'percent'
          then greatest(0, v_bi.price - v_bi.price * coalesce(v_bi.discount_value,0) / 100)
        else greatest(0, v_bi.price - coalesce(v_bi.discount_value,0))
      end;
      v_bprice := round(v_bprice, 2);
      v_line := round(v_bprice * v_bi.qty * v_bqty, 2);
      v_subtotal := v_subtotal + v_line;
      insert into public.order_items(order_id, menu_item_id, name_snapshot,
        unit_price, qty, line_total, notes, customization, addon_total)
      values (v_order_id, v_bi.menu_item_id, v_bi.name,
        v_bprice, v_bi.qty * v_bqty, v_line,
        'Bundle: '||v_b.name, 'null'::jsonb, 0);
    end loop;
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_subtotal);
end $$;
grant execute on function public.customer_self_order(text, jsonb) to anon, authenticated;

-- ---------- 3. customer_order_status: poll if order is ready ---------
create or replace function public.customer_order_status(p_token text, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_c public.customers%rowtype; v_o public.orders%rowtype;
begin
  select * into v_c from public.customers where token = p_token and is_active;
  if not found then return null; end if;
  select * into v_o from public.orders where id = p_order_id and customer_id = v_c.id;
  if not found then return null; end if;
  return jsonb_build_object(
    'order_id', v_o.id,
    'order_no', v_o.order_no,
    'status',   v_o.status,
    'total',    v_o.total
  );
end $$;
grant execute on function public.customer_order_status(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
