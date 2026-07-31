-- =====================================================================
-- BEVI & GO — Phase 39
--  1) Barista switching on a single POS login (acting cashier)
--  2) Resume no longer destroys the held order's items
--  3) Voids/refunds mirror the original payment method (incl. per item)
-- Idempotent; run after phase 38.
-- =====================================================================

-- ---------- 1. Staff picker for the POS barista switch ---------------
create or replace function public.pos_staff_list()
returns table(user_id uuid, email text, full_name text, role text)
language sql security definer set search_path = public, auth as $$
  select u.id,
         u.email::text,
         coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                  split_part(u.email::text, '@', 1)) as full_name,
         (select r.role::text from public.user_roles r
           where r.user_id = u.id
           order by case r.role::text when 'developer' then 1 when 'admin' then 2 else 3 end
           limit 1) as role
    from auth.users u
   where exists (select 1 from public.user_roles r where r.user_id = u.id)
   order by 3;
$$;
revoke all on function public.pos_staff_list() from public, anon;
grant execute on function public.pos_staff_list() to authenticated;

-- ---------- 2. Resume keeps the held items until checkout ------------
create or replace function public.pos_resume_order(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_items jsonb;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;

  select * into v_order from public.orders where id = p_order_id and status = 'on_hold';
  if not found then raise exception 'order not on hold'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
            'menu_item_id', oi.menu_item_id,
            'variant_id',   oi.variant_id,
            'variant_name', v.name,
            'name',         oi.name_snapshot,
            'unit_price',   oi.unit_price,
            'qty',          oi.qty,
            'notes',        oi.notes,
            'customization',oi.customization,
            'addon_total',  oi.addon_total,
            'is_upsell',    oi.is_upsell
         ) order by oi.id), '[]'::jsonb)
    into v_items
    from public.order_items oi
    left join public.menu_item_variants v on v.id = oi.variant_id
   where oi.order_id = p_order_id;

  -- NOTE: items are intentionally NOT deleted here. pos_create_order
  -- rebuilds them at checkout, so a cancelled/failed resume keeps the
  -- held order intact.
  return jsonb_build_object(
    'order_id',      v_order.id,
    'order_no',      v_order.order_no,
    'order_type',    v_order.order_type,
    'customer_name', v_order.customer_name,
    'notes',         v_order.notes,
    'items',         v_items
  );
end; $$;
grant execute on function public.pos_resume_order(uuid) to authenticated;

-- ---------- 3. pos_create_order: acting cashier + Manila date --------
create or replace function public.pos_create_order(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := auth.uid();
  v_cashier uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
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

  -- Shared terminal: the order is credited to the barista on duty.
  v_cashier := nullif(p_payload->>'acting_cashier_id','')::uuid;
  if v_cashier is null or not public.is_staff(v_cashier) then
    v_cashier := v_actor;
  end if;

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
           cashier_id = v_cashier,
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
      v_cashier, v_customer_id,
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
                  'order','orders', v_order_id::text, v_cashier);
      end loop;
    else
      for v_recipe in select inventory_item_id, qty_per_unit from public.recipes where menu_item_id = v_mi.id loop
        update public.inventory_items
           set stock_qty = stock_qty - (v_recipe.qty_per_unit * v_qty), updated_at = now()
         where id = v_recipe.inventory_item_id;
        insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
          values (v_recipe.inventory_item_id, -(v_recipe.qty_per_unit * v_qty),
                  'order','orders', v_order_id::text, v_cashier);
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

  delete from public.order_payments where order_id = v_order_id;

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
revoke all on function public.pos_create_order(jsonb) from public, anon;
grant execute on function public.pos_create_order(jsonb) to authenticated;

-- ---------- 4. Voids carry the original payment method ---------------
create or replace function public.pos_void_order_v2(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_o public.orders%rowtype;
  v_mirror_id uuid := gen_random_uuid();
  v_it record;
  v_no int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public._can_reverse_order(v_actor) then raise exception 'not authorized'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_o.txn_kind <> 'sale' then raise exception 'only sale orders can be voided'; end if;
  if v_o.status in ('voided','refunded') then raise exception 'order already %', v_o.status; end if;

  v_no := public._next_order_no(v_o.business_date);

  insert into public.orders(
    id, order_no, business_date, order_type, status,
    subtotal, tax, discount_total, total,
    cashier_id, customer_name, notes,
    parent_order_id, txn_kind, completed_at
  ) values (
    v_mirror_id, v_no, v_o.business_date, v_o.order_type, 'completed',
    -v_o.subtotal, -v_o.tax, -v_o.discount_total, -v_o.total,
    v_actor, v_o.customer_name,
    'VOID of #'||v_o.order_no::text||coalesce(' — '||p_reason,''),
    v_o.id, 'void', now()
  );

  for v_it in select * from public.order_items where order_id = p_order_id loop
    insert into public.order_items(
      order_id, menu_item_id, variant_id, name_snapshot, unit_price, qty, line_total, notes, parent_item_id
    ) values (
      v_mirror_id, v_it.menu_item_id, v_it.variant_id, v_it.name_snapshot,
      v_it.unit_price, -v_it.qty, -v_it.line_total, v_it.notes, v_it.id
    );

    perform public._restock_for_line(
      v_it.menu_item_id, v_it.variant_id, v_it.qty, 'void', v_mirror_id, v_actor
    );
  end loop;

  -- Mirror payments keep method AND method_code so cash stays cash.
  insert into public.order_payments(order_id, method, method_code, amount, change_due, fee_amount, reference)
    select v_mirror_id, method, method_code, -amount, -coalesce(change_due,0), -coalesce(fee_amount,0), 'VOID'
      from public.order_payments where order_id = p_order_id;

  update public.orders
     set status = 'voided',
         notes  = coalesce(notes,'') || E'\n[voided by '||v_actor::text||' at '||now()::text||coalesce(' — '||p_reason,'')||']'
   where id = p_order_id;

  return jsonb_build_object('mirror_order_id', v_mirror_id, 'order_no', v_no);
end $$;
grant execute on function public.pos_void_order_v2(uuid, text) to authenticated;

-- Per-item reversal: allocate the reversed amount across the original
-- payment methods proportionally, so End of Shift cash nets correctly.
create or replace function public._reverse_order_item(
  p_order_item_id uuid, p_qty numeric, p_reason text, p_kind text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_it public.order_items%rowtype;
  v_o public.orders%rowtype;
  v_mirror_id uuid := gen_random_uuid();
  v_no int;
  v_line_total numeric;
  v_qty_done numeric;
  v_remaining numeric;
  v_paid numeric;
  v_alloc numeric := 0;
  v_share numeric;
  v_p record;
  v_rows int;
  v_i int := 0;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public._can_reverse_order(v_actor) then raise exception 'not authorized'; end if;
  if p_kind not in ('void','refund') then raise exception 'invalid kind'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be > 0'; end if;

  select * into v_it from public.order_items where id = p_order_item_id for update;
  if not found then raise exception 'order item not found'; end if;
  select * into v_o from public.orders where id = v_it.order_id for update;
  if v_o.txn_kind <> 'sale' then raise exception 'can only reverse items on sale orders'; end if;

  select coalesce(sum(-oi.qty),0) into v_qty_done
    from public.order_items oi where oi.parent_item_id = v_it.id;
  v_remaining := v_it.qty - v_qty_done;
  if p_qty > v_remaining then
    raise exception 'cannot reverse %; only % remaining', p_qty, v_remaining;
  end if;

  v_line_total := round(v_it.unit_price * p_qty, 2);
  v_no := public._next_order_no(v_o.business_date);

  insert into public.orders(
    id, order_no, business_date, order_type, status,
    subtotal, tax, discount_total, total,
    cashier_id, customer_name, notes,
    parent_order_id, txn_kind, completed_at
  ) values (
    v_mirror_id, v_no, v_o.business_date, v_o.order_type, 'completed',
    -v_line_total, 0, 0, -v_line_total,
    v_actor, v_o.customer_name,
    upper(p_kind)||' item from #'||v_o.order_no::text||coalesce(' — '||p_reason,''),
    v_o.id, p_kind, now()
  );

  insert into public.order_items(
    order_id, menu_item_id, variant_id, name_snapshot, unit_price, qty, line_total, notes, parent_item_id
  ) values (
    v_mirror_id, v_it.menu_item_id, v_it.variant_id, v_it.name_snapshot,
    v_it.unit_price, -p_qty::int, -v_line_total, v_it.notes, v_it.id
  );

  perform public._restock_for_line(
    v_it.menu_item_id, v_it.variant_id, p_qty, p_kind, v_mirror_id, v_actor
  );

  -- Tag the reversal with the payment method(s) actually used.
  select coalesce(sum(amount - coalesce(change_due,0)), 0), count(*)
    into v_paid, v_rows
    from public.order_payments where order_id = v_o.id;

  if v_rows > 0 and v_paid > 0 then
    for v_p in
      select method, method_code, (amount - coalesce(change_due,0)) as net
        from public.order_payments where order_id = v_o.id order by id
    loop
      v_i := v_i + 1;
      if v_i = v_rows then
        v_share := round(v_line_total - v_alloc, 2);
      else
        v_share := round(v_line_total * (v_p.net / v_paid), 2);
        v_alloc := v_alloc + v_share;
      end if;
      if v_share <> 0 then
        insert into public.order_payments(order_id, method, method_code, amount, change_due, fee_amount, reference)
          values (v_mirror_id, v_p.method, v_p.method_code, -v_share, 0, 0, upper(p_kind));
      end if;
    end loop;
  end if;

  return jsonb_build_object('mirror_order_id', v_mirror_id, 'order_no', v_no, 'qty_reversed', p_qty);
end $$;

notify pgrst, 'reload schema';
