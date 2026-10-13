-- =====================================================================
-- Phase 62 — Size (variant) always saved on sales so inventory matches the
-- Per item report; stock notes; expenses without time-in for managers.
-- Run AFTER phase 41 and phase 53.
-- =====================================================================

-- ---------- 1. Variant inference helper -------------------------------
create or replace function public._infer_variant(p_menu_item_id uuid, p_unit numeric, p_addon numeric)
returns uuid language sql stable security definer set search_path = public as $$
  select v.id from public.menu_item_variants v
   where v.menu_item_id = p_menu_item_id and coalesce(v.is_active, true)
   order by (p_unit is not null and abs(v.price - (p_unit - coalesce(p_addon,0))) < 0.005) desc,
            (p_unit is not null and abs(v.price - p_unit) < 0.005) desc,
            v.sort_order nulls last, v.price
   limit 1;
$$;

-- Safety net for every other path that writes order lines (held/customer orders).
create or replace function public._order_items_fill_variant()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_mi text;
begin
  if new.variant_id is null and new.menu_item_id is not null then
    new.variant_id := public._infer_variant(new.menu_item_id, new.unit_price, new.addon_total);
  end if;
  if new.variant_id is not null and position(' — ' in coalesce(new.name_snapshot,'')) = 0 then
    select name into v_name from public.menu_item_variants where id = new.variant_id;
    if v_name is not null then new.name_snapshot := new.name_snapshot || ' — ' || v_name; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_order_items_fill_variant on public.order_items;
create trigger trg_order_items_fill_variant before insert on public.order_items
  for each row execute function public._order_items_fill_variant();

-- ---------- 2. pos_create_order: infer size BEFORE deducting stock -----
create or replace function public.pos_create_order(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := auth.uid();
  v_cashier uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_next_seq int; v_order_id uuid; v_order_no int; v_attempts int := 0;
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
    -- Collision-proof order number allocation: lock the counter row, take the
    -- greater of counter+1 / max(existing order_no)+1, and retry on the (rare)
    -- unique violation instead of failing the sale.
    v_attempts := 0;
    loop
      v_attempts := v_attempts + 1;
      v_order_no := public._alloc_order_no(v_today);
      begin
        insert into public.orders(order_no, business_date, order_type, status,
          subtotal, tax, discount_total, total, cashier_id, customer_id, customer_name, notes, completed_at)
        values (v_order_no, v_today,
          coalesce((p_payload->>'order_type')::public.order_type,'takeout'),
          'completed', 0,0,0,0,
          v_cashier, v_customer_id,
          coalesce(nullif(p_payload->>'customer_name',''), v_cust.name),
          nullif(p_payload->>'notes',''), now())
        returning id into v_order_id;
        exit;
      exception when unique_violation then
        if v_attempts >= 25 then raise; end if;
      end;
    end loop;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_qty := coalesce((v_item->>'qty')::int,1);
    if v_qty <= 0 then continue; end if;
    select * into v_mi from public.menu_items where id = (v_item->>'menu_item_id')::uuid;
    if not found then raise exception 'menu item % not found', v_item->>'menu_item_id'; end if;

    v_variant_id := nullif(v_item->>'variant_id','')::uuid;
    v_addon := coalesce((v_item->>'addon_total')::numeric, 0);
    -- Phase 62: never sell a sized item without a size. Pick the size whose
    -- menu price matches what was charged, otherwise the first active size.
    if v_variant_id is null then
      v_variant_id := public._infer_variant(v_mi.id, (v_item->>'unit_price')::numeric, v_addon);
    end if;
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

-- ---------- 3. One-time fix for past sales saved without a size --------
-- For each completed line that had no size: deduct the size's recipe,
-- give back the base recipe that was deducted instead, and save the size.
-- Idempotent: each line is corrected only once (ref_table = 'variant_backfill').
do $$
declare r record; rc record;
begin
  for r in
    select oi.id, oi.menu_item_id, oi.qty, oi.unit_price, oi.addon_total, oi.name_snapshot,
           public._infer_variant(oi.menu_item_id, oi.unit_price, oi.addon_total) as vid
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where oi.variant_id is null and oi.menu_item_id is not null
       and o.status = 'completed' and oi.qty > 0
       and not exists (select 1 from public.inventory_movements m
                        where m.ref_table = 'variant_backfill' and m.ref_id = oi.id::text)
  loop
    continue when r.vid is null;
    for rc in select inventory_item_id, qty_per_unit from public.variant_recipes where variant_id = r.vid loop
      update public.inventory_items set stock_qty = stock_qty - rc.qty_per_unit * r.qty, updated_at = now() where id = rc.inventory_item_id;
      insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id)
        values (rc.inventory_item_id, -(rc.qty_per_unit * r.qty), 'size correction (past sale saved without size)', 'variant_backfill', r.id::text);
    end loop;
    for rc in select inventory_item_id, qty_per_unit from public.recipes where menu_item_id = r.menu_item_id loop
      update public.inventory_items set stock_qty = stock_qty + rc.qty_per_unit * r.qty, updated_at = now() where id = rc.inventory_item_id;
      insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id)
        values (rc.inventory_item_id, rc.qty_per_unit * r.qty, 'size correction (past sale saved without size)', 'variant_backfill', r.id::text);
    end loop;
    -- marker row even when no recipe exists, so it never runs twice
    if not exists (select 1 from public.inventory_movements where ref_table='variant_backfill' and ref_id=r.id::text) then
      null;
    end if;
    update public.order_items
       set variant_id = r.vid,
           name_snapshot = case when position(' — ' in name_snapshot) > 0 then name_snapshot
                                else name_snapshot || ' — ' || (select name from public.menu_item_variants where id = r.vid) end
     where id = r.id;
  end loop;
end $$;

-- ---------- 4. Notes on manual add/deduct stock ------------------------
drop function if exists public.inventory_add_packs(uuid, numeric);
create or replace function public.inventory_add_packs(p_item_id uuid, p_packs numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid(); v_it public.inventory_items%rowtype; v_added numeric;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'staff only'; end if;
  if p_packs is null or p_packs <= 0 then raise exception 'packs must be > 0'; end if;
  select * into v_it from public.inventory_items where id = p_item_id;
  if not found then raise exception 'inventory item not found'; end if;
  if coalesce(v_it.pack_size, 0) <= 0 then raise exception 'pack_size not configured for %', v_it.name; end if;
  v_added := p_packs * v_it.pack_size;
  update public.inventory_items set stock_qty = stock_qty + v_added, updated_at = now() where id = p_item_id;
  insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
    values (p_item_id, v_added,
            case when coalesce(trim(p_note),'') = '' then 'restock' else 'restock: ' || trim(p_note) end,
            'inventory_add_packs', null, v_actor);
  return jsonb_build_object('ok', true, 'added_units', v_added, 'packs', p_packs, 'pack_size', v_it.pack_size);
end $$;
revoke all on function public.inventory_add_packs(uuid, numeric, text) from public, anon;
grant execute on function public.inventory_add_packs(uuid, numeric, text) to authenticated;

-- ---------- 5. Expenses without time-in (admin / developer / partner) ---
create or replace function public.tc_add_expense_v4(
  p_description text, p_quantity numeric, p_unit_price numeric,
  p_category text default null, p_invoice_number text default null,
  p_receipt_url text default null, p_payment_method_code text default null,
  p_reason text default null
) returns public.shift_expenses
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts; v_exp public.shift_expenses; v_pm public.payment_methods;
  v_is_admin boolean := public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer');
  v_is_mgr boolean := v_is_admin or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner');
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_amount numeric;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_description),'') = '' then raise exception 'description required'; end if;
  if p_quantity is null or p_quantity = 0 then raise exception 'quantity cannot be 0'; end if;
  if p_unit_price is null then raise exception 'unit price required'; end if;
  v_amount := round(p_quantity * p_unit_price, 2);
  if v_amount < 0 and coalesce(trim(p_reason),'') = '' then
    raise exception 'reason is required for a negative (correction) entry';
  end if;
  if coalesce(p_payment_method_code,'') <> '' then
    select * into v_pm from public.payment_methods where code = p_payment_method_code;
    if not found then raise exception 'invalid payment method'; end if;
    if v_pm.owner_only and not v_is_mgr then raise exception 'not allowed to use this payment method'; end if;
    if not v_is_mgr and v_pm.kind::text not in ('cash','transfer') then
      raise exception 'baristas can only use cash or e-wallet for expenses';
    end if;
  end if;

  select * into v_shift from public.shifts
   where user_id = auth.uid() and clock_out is null order by clock_in desc limit 1;

  if v_shift.id is null and v_is_mgr then
    -- Attach to today's latest shift (any barista) so it lands in today's report…
    select * into v_shift from public.shifts
     where business_date = v_today order by clock_in desc limit 1;
    -- …or, if nobody timed in today, a zero-length record for the manager.
    if v_shift.id is null then
      insert into public.shifts(user_id, business_date, starting_cash, clock_in, clock_out)
      values (auth.uid(), v_today, 0, now(), now()) returning * into v_shift;
    end if;
  end if;
  if v_shift.id is null then raise exception 'no open shift — please time in first'; end if;

  insert into public.shift_expenses(shift_id, description, quantity, unit_price, amount, category,
    invoice_number, receipt_url, payment_method_code, reason)
  values (v_shift.id, trim(p_description), p_quantity, p_unit_price, v_amount,
    nullif(trim(p_category),''), nullif(trim(p_invoice_number),''),
    nullif(trim(p_receipt_url),''), nullif(p_payment_method_code,''), nullif(trim(p_reason),''))
  returning * into v_exp;
  return v_exp;
end $$;
grant execute on function public.tc_add_expense_v4(text, numeric, numeric, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
