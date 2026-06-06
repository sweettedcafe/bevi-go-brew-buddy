-- =====================================================================
-- BEVI & GO — Phase 6: Menu customization + Most Ordered
-- Run AFTER supabase_phase5_schema.sql. Idempotent.
-- =====================================================================

-- 1. Menu item customization config (sizes, milks, extras, etc.) ----------
-- options jsonb shape:
-- {
--   "sizes":  [{"label":"Small 8oz","price_delta":0,"is_default":true},
--              {"label":"Medium 12oz","price_delta":20},
--              {"label":"Large 16oz","price_delta":40}],
--   "milks":  [{"label":"Whole","price_delta":0}, ...],
--   "extras": [{"label":"Extra shot","price_delta":15}, ...],
--   "allow_other": true,
--   "allow_notes": true,
--   "size_required": true
-- }
alter table public.menu_items
  add column if not exists options jsonb not null default '{}'::jsonb;

-- 2. Per-line customization + add-on price snapshot -----------------------
-- customization jsonb shape:
-- { "size": {"label":"...","price_delta":40},
--   "milk": {"label":"Oat","price_delta":15},
--   "extras":[{"label":"...","price_delta":10}, ...],
--   "other":[{"label":"...","price_delta":5}, ...] }
alter table public.order_items
  add column if not exists customization jsonb,
  add column if not exists addon_total   numeric(10,2) not null default 0;

-- 3. Most ordered view (last 30 days, completed orders only) --------------
create or replace view public.menu_item_popularity as
  select oi.menu_item_id,
         sum(oi.qty)::int          as qty_sold,
         count(distinct oi.order_id) as orders_count
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where o.status = 'completed'
     and o.created_at >= now() - interval '30 days'
   group by oi.menu_item_id;

grant select on public.menu_item_popularity to authenticated;

-- 4. Upgraded pos_create_order: accept unit_price + customization ---------
-- New per-item shape (backwards-compatible — falls back to base price):
-- { "menu_item_id":"<uuid>", "qty":1,
--   "unit_price": 120.00,            -- optional, includes addon_total
--   "addon_total": 40.00,            -- optional, snapshot of options price
--   "customization": { ...jsonb... }, -- optional
--   "notes": "less ice"              -- optional
-- }
create or replace function public.pos_create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_tz          text := 'Asia/Riyadh';
  v_today       date := (now() at time zone v_tz)::date;
  v_next_seq    int;
  v_order_id    uuid;
  v_order_no    int;
  v_subtotal    numeric(10,2) := 0;
  v_discount    numeric(10,2) := 0;
  v_total       numeric(10,2) := 0;
  v_item        jsonb;
  v_mi          public.menu_items%rowtype;
  v_qty         int;
  v_unit_price  numeric(10,2);
  v_addon       numeric(10,2);
  v_line_total  numeric(10,2);
  v_cust        jsonb;
  v_recipe      record;
  v_payment     jsonb;
  v_paid_total  numeric(10,2) := 0;
  v_order_type  public.order_type;
  v_code        text;
  v_dsc         public.discounts%rowtype;
  v_manual      jsonb;
  v_dsc_label   text;
  v_pm          public.payment_methods%rowtype;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;

  v_order_type := coalesce((p_payload->>'order_type')::public.order_type, 'takeout');

  insert into public.daily_order_counter(business_date, last_seq)
    values (v_today, 1)
    on conflict (business_date) do update set last_seq = public.daily_order_counter.last_seq + 1
    returning last_seq into v_next_seq;
  v_order_no := v_next_seq;

  insert into public.orders(order_no, business_date, order_type, status,
                            subtotal, tax, discount_total, total,
                            cashier_id, customer_name, notes, completed_at)
    values (v_order_no, v_today, v_order_type, 'completed',
            0, 0, 0, 0,
            v_actor, nullif(p_payload->>'customer_name',''), nullif(p_payload->>'notes',''), now())
    returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty <= 0 then continue; end if;
    select * into v_mi from public.menu_items where id = (v_item->>'menu_item_id')::uuid;
    if not found then raise exception 'menu item % not found', v_item->>'menu_item_id'; end if;

    v_addon      := coalesce((v_item->>'addon_total')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, v_mi.price + v_addon);
    v_cust       := nullif(v_item->'customization','null'::jsonb);
    v_line_total := round(v_unit_price * v_qty, 2);
    v_subtotal   := v_subtotal + v_line_total;

    insert into public.order_items(order_id, menu_item_id, name_snapshot,
                                   unit_price, qty, line_total, notes,
                                   customization, addon_total)
      values (v_order_id, v_mi.id, v_mi.name, v_unit_price, v_qty, v_line_total,
              nullif(v_item->>'notes',''),
              v_cust, v_addon);

    for v_recipe in select inventory_item_id, qty_per_unit from public.recipes where menu_item_id = v_mi.id loop
      update public.inventory_items
         set stock_qty = stock_qty - (v_recipe.qty_per_unit * v_qty),
             updated_at = now()
       where id = v_recipe.inventory_item_id;
      insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
        values (v_recipe.inventory_item_id, -(v_recipe.qty_per_unit * v_qty),
                'order','orders', v_order_id::text, v_actor);
    end loop;
  end loop;

  -- promo discount
  v_code := nullif(p_payload->>'discount_code','');
  if v_code is not null then
    select * into v_dsc from public.discounts where code = v_code and is_active = true;
    if not found then raise exception 'invalid promo code'; end if;
    if v_dsc.starts_at is not null and now() < v_dsc.starts_at then raise exception 'promo not started'; end if;
    if v_dsc.ends_at   is not null and now() > v_dsc.ends_at   then raise exception 'promo expired'; end if;
    if v_dsc.max_uses  is not null and v_dsc.uses_count >= v_dsc.max_uses then raise exception 'promo usage limit reached'; end if;
    if v_subtotal < v_dsc.min_subtotal then raise exception 'subtotal below promo minimum'; end if;
    if v_dsc.type = 'percent' then
      v_discount := round(v_subtotal * v_dsc.value / 100.0, 2);
    else
      v_discount := least(v_dsc.value, v_subtotal);
    end if;
    v_dsc_label := v_dsc.name;
    update public.discounts set uses_count = uses_count + 1, updated_at = now() where id = v_dsc.id;
    update public.orders
       set discount_id = v_dsc.id, discount_code = v_dsc.code, discount_label = v_dsc_label
     where id = v_order_id;
  else
    v_manual := p_payload->'manual_discount';
    if v_manual is not null and v_manual <> 'null'::jsonb then
      if (v_manual->>'type') = 'percent' then
        v_discount := round(v_subtotal * (v_manual->>'value')::numeric / 100.0, 2);
      else
        v_discount := least((v_manual->>'value')::numeric, v_subtotal);
      end if;
      v_dsc_label := coalesce(nullif(v_manual->>'label',''), 'Manual discount');
      update public.orders
         set discount_label = v_dsc_label
       where id = v_order_id;
    end if;
  end if;

  v_total := greatest(0, v_subtotal - v_discount);

  -- payments
  for v_payment in select * from jsonb_array_elements(coalesce(p_payload->'payments','[]'::jsonb)) loop
    select * into v_pm from public.payment_methods where code = v_payment->>'method_code' and is_active = true;
    if not found then raise exception 'invalid payment method %', v_payment->>'method_code'; end if;
    insert into public.payments(order_id, method, method_code, amount, change_due, fee_amount, reference, created_by)
      values (v_order_id, v_pm.kind, v_pm.code,
              coalesce((v_payment->>'amount')::numeric, 0),
              coalesce((v_payment->>'change_due')::numeric, 0),
              coalesce((v_payment->>'fee_amount')::numeric, 0),
              nullif(v_payment->>'reference',''),
              v_actor);
    v_paid_total := v_paid_total + coalesce((v_payment->>'amount')::numeric, 0)
                                 - coalesce((v_payment->>'change_due')::numeric, 0);
  end loop;

  if v_paid_total + 0.01 < v_total then
    raise exception 'payments % do not cover total %', v_paid_total, v_total;
  end if;

  update public.orders
     set subtotal = v_subtotal,
         discount_total = v_discount,
         total = v_total
   where id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_total);
end; $$;

grant execute on function public.pos_create_order(jsonb) to authenticated;

-- 5. Upgrade pos_hold_order to accept customization too -------------------
create or replace function public.pos_hold_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_tz         text := 'Asia/Riyadh';
  v_today      date := (now() at time zone v_tz)::date;
  v_seq        int;
  v_order_id   uuid;
  v_order_no   int;
  v_subtotal   numeric(10,2) := 0;
  v_item       jsonb;
  v_mi         public.menu_items%rowtype;
  v_qty        int;
  v_addon      numeric(10,2);
  v_unit_price numeric(10,2);
  v_line_total numeric(10,2);
  v_cust       jsonb;
  v_order_type public.order_type;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;

  v_order_type := coalesce((p_payload->>'order_type')::public.order_type, 'takeout');

  insert into public.daily_order_counter(business_date, last_seq)
    values (v_today, 1)
    on conflict (business_date) do update set last_seq = public.daily_order_counter.last_seq + 1
    returning last_seq into v_seq;
  v_order_no := v_seq;

  insert into public.orders(order_no, business_date, order_type, status,
                            subtotal, tax, discount_total, total,
                            cashier_id, customer_name, notes,
                            held_at, held_by)
    values (v_order_no, v_today, v_order_type, 'on_hold',
            0, 0, 0, 0,
            v_actor, nullif(p_payload->>'customer_name',''),
            nullif(p_payload->>'notes',''),
            now(), v_actor)
    returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty <= 0 then continue; end if;
    select * into v_mi from public.menu_items where id = (v_item->>'menu_item_id')::uuid;
    if not found then raise exception 'menu item % not found', v_item->>'menu_item_id'; end if;
    v_addon      := coalesce((v_item->>'addon_total')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, v_mi.price + v_addon);
    v_cust       := nullif(v_item->'customization','null'::jsonb);
    v_line_total := round(v_unit_price * v_qty, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into public.order_items(order_id, menu_item_id, name_snapshot,
                                   unit_price, qty, line_total, notes,
                                   customization, addon_total)
      values (v_order_id, v_mi.id, v_mi.name, v_unit_price, v_qty, v_line_total,
              nullif(v_item->>'notes',''),
              v_cust, v_addon);
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no);
end; $$;

grant execute on function public.pos_hold_order(jsonb) to authenticated;

-- 6. pos_resume_order returns customization too ---------------------------
create or replace function public.pos_resume_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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
            'menu_item_id', menu_item_id,
            'name', name_snapshot,
            'unit_price', unit_price,
            'qty', qty,
            'notes', notes,
            'customization', customization,
            'addon_total', addon_total
         ) order by id), '[]'::jsonb)
    into v_items
    from public.order_items where order_id = p_order_id;

  delete from public.orders where id = p_order_id;

  return jsonb_build_object(
    'order_type',    v_order.order_type,
    'customer_name', v_order.customer_name,
    'notes',         v_order.notes,
    'items',         v_items
  );
end; $$;

grant execute on function public.pos_resume_order(uuid) to authenticated;
