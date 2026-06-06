-- =====================================================================
-- BEVI & GO — Phase 8: Customers, QR/Barcode Loyalty, Self Pre-Order
-- Run AFTER phases 1–7.
-- Idempotent.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- 1. CUSTOMERS ---------------------------------------------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,    -- numeric short code, used in CODE128 barcode
  token       text unique not null,    -- url-safe token used in QR for self-order
  name        text not null,
  phone       text,
  email       text,
  points      integer not null default 0,
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.customers enable row level security;
create index if not exists customers_name_idx on public.customers(lower(name));
create index if not exists customers_phone_idx on public.customers(phone);

-- ---------- 2. LOYALTY SETTINGS (singleton) --------------------------
create table if not exists public.loyalty_settings (
  id                int primary key default 1,
  is_active         boolean not null default true,
  earn_rate         numeric(10,4) not null default 1,    -- points per ₱1 spent
  redeem_threshold  integer not null default 100,        -- points required per redemption
  redeem_value      numeric(10,2) not null default 20,   -- peso value per redemption
  updated_at        timestamptz not null default now(),
  constraint loyalty_settings_singleton check (id = 1)
);
insert into public.loyalty_settings(id) values (1) on conflict (id) do nothing;
alter table public.loyalty_settings enable row level security;

-- ---------- 3. EXTEND ORDERS -----------------------------------------
alter table public.orders
  add column if not exists customer_id     uuid references public.customers(id) on delete set null,
  add column if not exists points_earned   integer not null default 0,
  add column if not exists points_redeemed integer not null default 0,
  add column if not exists source          text not null default 'pos'; -- 'pos' | 'self'

-- ---------- 4. GRANTS -------------------------------------------------
grant select, insert, update on public.customers        to authenticated;
grant select, update          on public.loyalty_settings to authenticated;

-- ---------- 5. RLS POLICIES ------------------------------------------
drop policy if exists "cust staff read"   on public.customers;
drop policy if exists "cust staff write"  on public.customers;
create policy "cust staff read" on public.customers
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "cust staff write" on public.customers
  for all to authenticated
  using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

drop policy if exists "loy staff read"  on public.loyalty_settings;
drop policy if exists "loy admin write" on public.loyalty_settings;
create policy "loy staff read" on public.loyalty_settings
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "loy admin write" on public.loyalty_settings
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

-- ---------- 6. HELPERS -----------------------------------------------
create or replace function public._gen_customer_code()
returns text language plpgsql as $$
declare v_code text; v_tries int := 0;
begin
  loop
    -- 8-digit numeric code, scannable as CODE128
    v_code := lpad((floor(random()*100000000))::int::text, 8, '0');
    exit when not exists(select 1 from public.customers where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then raise exception 'cannot generate unique customer code'; end if;
  end loop;
  return v_code;
end $$;

create or replace function public._gen_customer_token()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  v_token := encode(gen_random_bytes(18), 'base64');
  v_token := replace(replace(replace(v_token, '+',''), '/',''), '=','');
  return left(v_token, 22);
end $$;

-- ---------- 7. PUBLIC: register customer (anon allowed) --------------
-- Used by public /register page. Returns code + token.
create or replace function public.customer_self_register(
  p_name text, p_phone text, p_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_code text; v_token text;
begin
  if coalesce(trim(p_name),'') = '' then raise exception 'name required'; end if;
  -- If phone provided & exists, return that customer (idempotent)
  if p_phone is not null and trim(p_phone) <> '' then
    select id, code, token into v_id, v_code, v_token
    from public.customers where phone = trim(p_phone) limit 1;
    if found then
      return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',true);
    end if;
  end if;
  v_code  := public._gen_customer_code();
  v_token := public._gen_customer_token();
  insert into public.customers(code, token, name, phone, email)
    values (v_code, v_token, trim(p_name), nullif(trim(p_phone),''), nullif(trim(p_email),''))
    returning id into v_id;
  return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',false);
end $$;
grant execute on function public.customer_self_register(text,text,text) to anon, authenticated;

-- ---------- 8. PUBLIC: load customer by QR token ---------------------
create or replace function public.customer_by_token(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_c public.customers%rowtype;
begin
  select * into v_c from public.customers where token = p_token and is_active = true;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_c.id, 'code', v_c.code, 'name', v_c.name,
    'phone', v_c.phone, 'points', v_c.points
  );
end $$;
grant execute on function public.customer_by_token(text) to anon, authenticated;

-- ---------- 9. PUBLIC: get active menu (for self-order page) ---------
create or replace function public.public_menu()
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'sort_order', c.sort_order
      ) order by c.sort_order) from public.categories c where c.is_active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'category_id', m.category_id, 'name', m.name,
        'description', m.description, 'price', m.price, 'options', m.options
      ) order by m.sort_order) from public.menu_items m where m.is_active), '[]'::jsonb)
  );
$$;
grant execute on function public.public_menu() to anon, authenticated;

-- ---------- 10. PUBLIC: customer self-places order (HELD) ------------
-- Always creates an on_hold order tied to customer. Barista resumes & charges.
create or replace function public.customer_self_order(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_c public.customers%rowtype;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_next_seq int;
  v_order_id uuid;
  v_order_no int;
  v_subtotal numeric(10,2) := 0;
  v_item jsonb; v_mi public.menu_items%rowtype;
  v_qty int; v_unit numeric(10,2); v_addon numeric(10,2); v_line numeric(10,2);
begin
  select * into v_c from public.customers where token = p_token and is_active;
  if not found then raise exception 'invalid customer token'; end if;

  insert into public.daily_order_counter(business_date, last_seq) values(v_today,1)
    on conflict(business_date) do update set last_seq=public.daily_order_counter.last_seq+1
    returning last_seq into v_next_seq;
  v_order_no := v_next_seq;

  insert into public.orders(order_no, business_date, order_type, status,
    subtotal, tax, discount_total, total, customer_id, customer_name,
    notes, source, held_at)
  values (v_order_no, v_today,
    coalesce((p_payload->>'order_type')::public.order_type,'takeout'),
    'on_hold', 0,0,0,0,
    v_c.id, v_c.name, nullif(p_payload->>'notes',''),
    'self', now())
  returning id into v_order_id;

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

-- ---------- 11. STAFF: customer lookup by code (barista scan) --------
create or replace function public.customer_lookup(p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_c public.customers%rowtype; v_orders jsonb;
begin
  if not public.is_staff(auth.uid()) then raise exception 'not authorized'; end if;
  select * into v_c from public.customers
    where (code = trim(p_code) or id::text = trim(p_code)) and is_active;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'order_no', order_no, 'created_at', created_at,
    'total', total, 'status', status
  ) order by created_at desc), '[]'::jsonb) into v_orders
  from (select * from public.orders where customer_id = v_c.id
        order by created_at desc limit 10) t;
  return jsonb_build_object(
    'id', v_c.id, 'code', v_c.code, 'token', v_c.token,
    'name', v_c.name, 'phone', v_c.phone, 'email', v_c.email,
    'points', v_c.points, 'recent_orders', v_orders
  );
end $$;
grant execute on function public.customer_lookup(text) to authenticated;

-- ---------- 12. UPGRADE pos_create_order: customer + loyalty ---------
-- Adds: customer_id, redeem_points (int). Earns floor(total*earn_rate).
-- Redeem creates a discount line of (redeem_points/threshold)*value.
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

  -- If a held self-order is being completed, reuse its order row
  v_existing_order_id := nullif(p_payload->>'existing_order_id','')::uuid;

  if v_existing_order_id is not null then
    update public.orders set status = 'completed', completed_at = now(),
      cashier_id = v_actor where id = v_existing_order_id;
    v_order_id := v_existing_order_id;
    select order_no into v_order_no from public.orders where id = v_order_id;
    select coalesce(sum(line_total),0) into v_subtotal from public.order_items where order_id = v_order_id;
    v_resumed_self := true;
    -- inventory deduction for resumed self-orders (held orders skip deduction)
    for v_item in select jsonb_build_object('menu_item_id', menu_item_id, 'qty', qty) as j
                  from public.order_items where order_id = v_order_id loop
      v_qty := (v_item->'j'->>'qty')::int;
      for v_recipe in select inventory_item_id, qty_per_unit from public.recipes
                       where menu_item_id = (v_item->'j'->>'menu_item_id')::uuid loop
        update public.inventory_items
           set stock_qty = stock_qty - (v_recipe.qty_per_unit * v_qty), updated_at = now()
         where id = v_recipe.inventory_item_id;
        insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
          values (v_recipe.inventory_item_id, -(v_recipe.qty_per_unit * v_qty),
                  'order','orders', v_order_id::text, v_actor);
      end loop;
    end loop;
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

    for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
      v_qty := coalesce((v_item->>'qty')::int,1);
      if v_qty <= 0 then continue; end if;
      select * into v_mi from public.menu_items where id = (v_item->>'menu_item_id')::uuid;
      if not found then raise exception 'menu item % not found', v_item->>'menu_item_id'; end if;
      v_addon := coalesce((v_item->>'addon_total')::numeric, 0);
      v_unit  := coalesce((v_item->>'unit_price')::numeric, v_mi.price + v_addon);
      v_line  := round(v_unit * v_qty, 2);
      v_subtotal := v_subtotal + v_line;
      insert into public.order_items(order_id, menu_item_id, name_snapshot,
        unit_price, qty, line_total, notes, customization, addon_total)
      values (v_order_id, v_mi.id, v_mi.name, v_unit, v_qty, v_line,
        nullif(v_item->>'notes',''),
        coalesce(v_item->'customization','null'::jsonb),
        v_addon);
      for v_recipe in select inventory_item_id, qty_per_unit from public.recipes where menu_item_id = v_mi.id loop
        update public.inventory_items
           set stock_qty = stock_qty - (v_recipe.qty_per_unit * v_qty), updated_at = now()
         where id = v_recipe.inventory_item_id;
        insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
          values (v_recipe.inventory_item_id, -(v_recipe.qty_per_unit * v_qty),
                  'order','orders', v_order_id::text, v_actor);
      end loop;
    end loop;
  end if;

  -- promo or manual discount (skip if resumed self-order already has discounts)
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
      if not (public.has_role(v_actor,'admin') or public.has_role(v_actor,'developer')) then
        raise exception 'manual discount requires admin role';
      end if;
      v_dsc_label := coalesce(v_manual->>'label','Manual discount');
      if (v_manual->>'type') = 'percent' then
        v_discount := round(v_subtotal * (v_manual->>'value')::numeric / 100.0, 2);
      else v_discount := least((v_manual->>'value')::numeric, v_subtotal); end if;
      update public.orders set discount_label = v_dsc_label where id = v_order_id;
    end if;
  end if;

  -- loyalty redemption stacks on top of any other discount
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

  -- payments
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
    raise exception 'underpaid: paid % vs total %', v_paid_total, v_total;
  end if;

  -- accrue loyalty
  if v_customer_id is not null and v_loyalty.is_active then
    v_earned := floor(v_total * v_loyalty.earn_rate)::int;
    if v_earned > 0 then
      update public.customers set points = points + v_earned, updated_at = now()
       where id = v_customer_id;
      update public.orders set points_earned = v_earned where id = v_order_id;
    end if;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id, 'order_no', v_order_no,
    'subtotal', v_subtotal, 'discount_total', v_discount,
    'discount_label', v_dsc_label, 'total', v_total,
    'paid_total', v_paid_total, 'points_earned', v_earned,
    'points_redeemed', v_redeem
  );
end $$;
grant execute on function public.pos_create_order(jsonb) to authenticated;
