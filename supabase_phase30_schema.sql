-- =====================================================================
-- BEVI & GO — Phase 30: mark upsell-originated order items
--   1) add order_items.is_upsell
--   2) pos_create_order — persist is_upsell from payload
--   3) customer_self_order — persist is_upsell from payload
-- Idempotent; run after phase 29.
-- =====================================================================

alter table public.order_items
  add column if not exists is_upsell boolean not null default false;

create index if not exists order_items_upsell_idx
  on public.order_items(is_upsell) where is_upsell = true;

-- --------------------- pos_create_order ------------------------------
create or replace function public.pos_create_order(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_next_seq int; v_order_id uuid; v_order_no int;
  v_subtotal numeric(10,2) := 0; v_discount numeric(10,2) := 0; v_total numeric(10,2) := 0;
  v_item jsonb; v_mi public.menu_items%rowtype; v_qty int;
  v_unit numeric(10,2); v_addon numeric(10,2); v_line numeric(10,2);
  v_recipe record; v_payment jsonb; v_paid_total numeric(10,2) := 0;
  v_code text; v_dsc public.discounts%rowtype; v_manual jsonb; v_dsc_label text;
  v_pm public.payment_methods%rowtype; v_pm_kind public.payment_method;
  v_customer_id uuid; v_cust public.customers%rowtype;
  v_redeem int := 0; v_loyalty public.loyalty_settings%rowtype;
  v_redeem_amt numeric(10,2) := 0; v_earned int := 0;
  v_existing_order_id uuid; v_resumed_self boolean := false;
  v_variant_id uuid; v_variant public.menu_item_variants%rowtype;
  v_name_snap text;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;

  select * into v_loyalty from public.loyalty_settings where id = 1;

  v_customer_id := nullif(p_payload->>'customer_id','')::uuid;
  if v_customer_id is not null then
    select * into v_cust from public.customers where id = v_customer_id;
    if not found then raise exception 'customer not found'; end if;
  end if;

  v_redeem := coalesce((p_payload->>'redeem_points')::int, 0);
  if v_redeem > 0 then
    if v_customer_id is null then raise exception 'redeem requires customer'; end if;
    if not v_loyalty.is_active then raise exception 'loyalty inactive'; end if;
    if v_cust.points < v_redeem then raise exception 'insufficient points'; end if;
    if v_loyalty.redeem_threshold <= 0 then raise exception 'invalid loyalty config'; end if;
    if v_redeem % v_loyalty.redeem_threshold <> 0 then
      raise exception 'redeem must be a multiple of %', v_loyalty.redeem_threshold;
    end if;
    v_redeem_amt := round((v_redeem::numeric / v_loyalty.redeem_threshold) * v_loyalty.redeem_value, 2);
  end if;

  v_existing_order_id := nullif(p_payload->>'existing_order_id','')::uuid;

  if v_existing_order_id is not null then
    select order_no into v_order_no from public.orders where id = v_existing_order_id;
    if v_order_no is null then raise exception 'existing order not found'; end if;
    v_order_id := v_existing_order_id;
    v_resumed_self := true;

    update public.orders
       set status = 'completed', completed_at = now(),
           cashier_id = v_actor,
           customer_id  = coalesce(v_customer_id, customer_id),
           customer_name= coalesce(nullif(p_payload->>'customer_name',''), customer_name),
           order_type   = coalesce((p_payload->>'order_type')::public.order_type, order_type),
           notes        = coalesce(nullif(p_payload->>'notes',''), notes)
     where id = v_order_id;

    delete from public.order_items where order_id = v_order_id;
  else
    insert into public.daily_order_counter(business_date, last_seq) values (v_today,1)
      on conflict (business_date) do update set last_seq = public.daily_order_counter.last_seq + 1
      returning last_seq into v_next_seq;
    v_order_no := v_next_seq;

    insert into public.orders(order_no, business_date, order_type, status,
      subtotal, tax, discount_total, total, cashier_id, customer_id, customer_name, notes, completed_at)
    values (v_order_no, v_today,
      coalesce((p_payload->>'order_type')::public.order_type,'takeout'),
      'completed', 0,0,0,0,
      v_actor, v_customer_id,
      coalesce(nullif(p_payload->>'customer_name',''), v_cust.name),
      nullif(p_payload->>'notes',''), now())
    returning id into v_order_id;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_qty := coalesce((v_item->>'qty')::int,1);
    if v_qty <= 0 then continue; end if;
    select * into v_mi from public.menu_items where id = (v_item->>'menu_item_id')::uuid;
    if not found then raise exception 'menu item % not found', v_item->>'menu_item_id'; end if;

    v_variant_id := nullif(v_item->>'variant_id','')::uuid;
    v_addon := coalesce((v_item->>'addon_total')::numeric, 0);
    v_name_snap := v_mi.name;

    if v_variant_id is not null then
      select * into v_variant from public.menu_item_variants where id = v_variant_id;
      if not found then raise exception 'variant % not found', v_variant_id; end if;
      v_unit := coalesce((v_item->>'unit_price')::numeric, v_variant.price + v_addon);
      v_name_snap := v_mi.name || ' — ' || v_variant.name;
    else
      v_unit := coalesce((v_item->>'unit_price')::numeric, v_mi.price + v_addon);
    end if;

    v_line := round(v_unit * v_qty, 2);
    v_subtotal := v_subtotal + v_line;

    insert into public.order_items(order_id, menu_item_id, variant_id, name_snapshot,
      unit_price, qty, line_total, notes, customization, addon_total, is_upsell)
    values (v_order_id, v_mi.id, v_variant_id, v_name_snap, v_unit, v_qty, v_line,
      nullif(v_item->>'notes',''),
      coalesce(v_item->'customization','null'::jsonb),
      v_addon,
      coalesce((v_item->>'is_upsell')::boolean, false));

    if v_variant_id is not null then
      for v_recipe in select inventory_item_id, qty_per_unit from public.variant_recipes
                       where variant_id = v_variant_id loop
        update public.inventory_items
           set stock_qty = stock_qty - (v_recipe.qty_per_unit * v_qty), updated_at = now()
         where id = v_recipe.inventory_item_id;
        insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
          values (v_recipe.inventory_item_id, -(v_recipe.qty_per_unit * v_qty),
                  'order','orders', v_order_id::text, v_actor);
      end loop;
    else
      for v_recipe in select inventory_item_id, qty_per_unit from public.recipes where menu_item_id = v_mi.id loop
        update public.inventory_items
           set stock_qty = stock_qty - (v_recipe.qty_per_unit * v_qty), updated_at = now()
         where id = v_recipe.inventory_item_id;
        insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
          values (v_recipe.inventory_item_id, -(v_recipe.qty_per_unit * v_qty),
                  'order','orders', v_order_id::text, v_actor);
      end loop;
    end if;
  end loop;

  v_code := nullif(p_payload->>'discount_code','');
  if v_code is not null then
    select * into v_dsc from public.discounts where code = v_code and is_active;
    if not found then raise exception 'invalid promo code'; end if;
    if v_dsc.starts_at is not null and now() < v_dsc.starts_at then raise exception 'promo not started'; end if;
    if v_dsc.ends_at   is not null and now() > v_dsc.ends_at   then raise exception 'promo expired'; end if;
    if v_dsc.max_uses  is not null and v_dsc.uses_count >= v_dsc.max_uses then raise exception 'promo usage limit reached'; end if;
    if v_subtotal < v_dsc.min_subtotal then raise exception 'subtotal below promo minimum'; end if;
    if v_dsc.type = 'percent' then v_discount := round(v_subtotal * v_dsc.value / 100.0, 2);
    else v_discount := least(v_dsc.value, v_subtotal); end if;
    v_dsc_label := v_dsc.name;
    update public.discounts set uses_count = uses_count + 1, updated_at = now() where id = v_dsc.id;
    update public.orders set discount_id = v_dsc.id, discount_code = v_dsc.code, discount_label = v_dsc_label
     where id = v_order_id;
  else
    v_manual := p_payload->'manual_discount';
    if v_manual is not null and jsonb_typeof(v_manual) = 'object' then
      v_dsc_label := coalesce(v_manual->>'label','Manual discount');
      if (v_manual->>'type') = 'percent' then
        v_discount := round(v_subtotal * (v_manual->>'value')::numeric / 100.0, 2);
      else v_discount := least((v_manual->>'value')::numeric, v_subtotal); end if;
      update public.orders set discount_label = v_dsc_label where id = v_order_id;
    end if;
  end if;

  if v_redeem_amt > 0 then
    v_discount := v_discount + v_redeem_amt;
    if v_dsc_label is null then v_dsc_label := 'Loyalty redemption';
    else v_dsc_label := v_dsc_label || ' + Loyalty'; end if;
    update public.orders
       set discount_label = v_dsc_label, points_redeemed = v_redeem
     where id = v_order_id;
    update public.customers set points = points - v_redeem, updated_at = now() where id = v_customer_id;
  end if;

  v_discount := least(v_discount, v_subtotal);
  v_total := greatest(0, v_subtotal - v_discount);

  update public.orders set subtotal = v_subtotal, discount_total = v_discount, total = v_total
   where id = v_order_id;

  for v_payment in select * from jsonb_array_elements(coalesce(p_payload->'payments','[]'::jsonb)) loop
    select * into v_pm from public.payment_methods where code = (v_payment->>'method_code');
    if found then v_pm_kind := v_pm.kind;
    else v_pm_kind := coalesce((v_payment->>'method')::public.payment_method, 'other'); end if;
    insert into public.order_payments(order_id, method, method_code, amount, change_due, fee_amount, reference)
      values (v_order_id, v_pm_kind, nullif(v_payment->>'method_code',''),
              (v_payment->>'amount')::numeric,
              coalesce((v_payment->>'change_due')::numeric, 0),
              coalesce((v_payment->>'fee_amount')::numeric, 0),
              nullif(v_payment->>'reference',''));
    v_paid_total := v_paid_total + (v_payment->>'amount')::numeric - coalesce((v_payment->>'change_due')::numeric, 0);
  end loop;

  if round(v_paid_total,2) < round(v_total,2) then
    raise exception 'payment insufficient: paid %, due %', v_paid_total, v_total;
  end if;

  if v_customer_id is not null and v_loyalty.is_active and not v_resumed_self then
    v_earned := floor(v_total * v_loyalty.earn_rate)::int;
    if v_earned > 0 then
      update public.customers set points = points + v_earned, updated_at = now() where id = v_customer_id;
      update public.orders set points_earned = v_earned where id = v_order_id;
    end if;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_no', v_order_no,
    'subtotal', v_subtotal,
    'discount_total', v_discount,
    'total', v_total,
    'points_earned', v_earned,
    'points_redeemed', v_redeem
  );
end $$;
revoke all on function public.pos_create_order(jsonb) from public, anon, authenticated;
grant execute on function public.pos_create_order(jsonb) to authenticated;

-- --------------------- customer_self_order ---------------------------
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
  v_key text := public._normalize_customer_token(p_token);
begin
  select * into v_c from public.customers where token = v_key and deleted_at is null;
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
    v_qty := coalesce((v_item->>'qty')::int,1);
    if v_qty <= 0 then continue; end if;
    select * into v_mi from public.menu_items where id = (v_item->>'menu_item_id')::uuid and is_active;
    if not found then raise exception 'menu item unavailable'; end if;
    v_addon := coalesce((v_item->>'addon_total')::numeric, 0);
    v_unit  := v_mi.price + v_addon;
    v_line  := round(v_unit * v_qty, 2);
    v_subtotal := v_subtotal + v_line;
    insert into public.order_items(order_id, menu_item_id, name_snapshot,
      unit_price, qty, line_total, notes, customization, addon_total, is_upsell)
    values (v_order_id, v_mi.id, v_mi.name, v_unit, v_qty, v_line,
      nullif(v_item->>'notes',''),
      coalesce(v_item->'customization','null'::jsonb),
      v_addon,
      coalesce((v_item->>'is_upsell')::boolean, false));
  end loop;

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

notify pgrst, 'reload schema';
