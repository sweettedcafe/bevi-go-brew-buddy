-- =====================================================================
-- BEVI & GO — Phase 15: Product variants, unique product codes,
-- pack-based inventory replenishment.
-- Run after phase 14.
-- =====================================================================

-- ---------- 1. UNIQUE PRODUCT CODE on menu_items --------------------
create sequence if not exists public.menu_item_code_seq start 1;

alter table public.menu_items
  add column if not exists product_code text,
  add column if not exists has_variants boolean not null default false;

create or replace function public.menu_items_set_code()
returns trigger language plpgsql as $$
begin
  if new.product_code is null or new.product_code = '' then
    new.product_code := 'MENU-' || lpad(nextval('public.menu_item_code_seq')::text, 6, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_menu_items_set_code on public.menu_items;
create trigger trg_menu_items_set_code
  before insert on public.menu_items
  for each row execute function public.menu_items_set_code();

-- Backfill existing rows
do $$
declare r record;
begin
  for r in select id from public.menu_items where product_code is null or product_code = '' loop
    update public.menu_items
       set product_code = 'MENU-' || lpad(nextval('public.menu_item_code_seq')::text, 6, '0')
     where id = r.id;
  end loop;
end $$;

alter table public.menu_items
  alter column product_code set not null;

create unique index if not exists menu_items_product_code_uidx
  on public.menu_items(product_code);

-- ---------- 2. MENU_ITEM_VARIANTS ------------------------------------
create table if not exists public.menu_item_variants (
  id           uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name         text not null,
  price        numeric(10,2) not null default 0 check (price >= 0),
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists menu_item_variants_uniq
  on public.menu_item_variants(menu_item_id, lower(name));

grant select, insert, update, delete on public.menu_item_variants to authenticated;
grant all on public.menu_item_variants to service_role;

alter table public.menu_item_variants enable row level security;

drop policy if exists "variants read" on public.menu_item_variants;
create policy "variants read" on public.menu_item_variants
  for select to authenticated using (true);

drop policy if exists "variants write" on public.menu_item_variants;
create policy "variants write" on public.menu_item_variants
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

-- ---------- 3. VARIANT_RECIPES (per-variant recipe rows) -------------
create table if not exists public.variant_recipes (
  variant_id        uuid not null references public.menu_item_variants(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  qty_per_unit      numeric(14,4) not null check (qty_per_unit > 0),
  primary key (variant_id, inventory_item_id)
);

grant select, insert, update, delete on public.variant_recipes to authenticated;
grant all on public.variant_recipes to service_role;

alter table public.variant_recipes enable row level security;

drop policy if exists "variant_recipes read" on public.variant_recipes;
create policy "variant_recipes read" on public.variant_recipes
  for select to authenticated using (true);

drop policy if exists "variant_recipes write" on public.variant_recipes;
create policy "variant_recipes write" on public.variant_recipes
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

-- ---------- 4. ORDER_ITEMS.variant_id --------------------------------
alter table public.order_items
  add column if not exists variant_id uuid references public.menu_item_variants(id) on delete set null;

-- ---------- 5. INVENTORY pack-based replenishment --------------------
alter table public.inventory_items
  add column if not exists purchase_unit text;

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

  update public.inventory_items
     set stock_qty      = stock_qty + v_added,
         full_stock_qty = coalesce(full_stock_qty, 0) + v_added,
         updated_at     = now()
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

revoke all on function public.inventory_add_packs(uuid, numeric) from public, anon, authenticated;
grant execute on function public.inventory_add_packs(uuid, numeric) to authenticated;

-- ---------- 6. POS_CREATE_ORDER — variant-aware ---------------------
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
    update public.orders set status = 'completed', completed_at = now(),
      cashier_id = v_actor where id = v_existing_order_id;
    v_order_id := v_existing_order_id;
    select order_no into v_order_no from public.orders where id = v_order_id;
    select coalesce(sum(line_total),0) into v_subtotal from public.order_items where order_id = v_order_id;
    v_resumed_self := true;
    -- Deduction for resumed self-orders (variant aware)
    for v_item in select jsonb_build_object('menu_item_id', menu_item_id, 'variant_id', variant_id, 'qty', qty) as j
                  from public.order_items where order_id = v_order_id loop
      v_qty := (v_item->'j'->>'qty')::int;
      v_variant_id := nullif(v_item->'j'->>'variant_id','')::uuid;
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
        for v_recipe in select inventory_item_id, qty_per_unit from public.recipes
                         where menu_item_id = (v_item->'j'->>'menu_item_id')::uuid loop
          update public.inventory_items
             set stock_qty = stock_qty - (v_recipe.qty_per_unit * v_qty), updated_at = now()
           where id = v_recipe.inventory_item_id;
          insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
            values (v_recipe.inventory_item_id, -(v_recipe.qty_per_unit * v_qty),
                    'order','orders', v_order_id::text, v_actor);
        end loop;
      end if;
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
        unit_price, qty, line_total, notes, customization, addon_total)
      values (v_order_id, v_mi.id, v_variant_id, v_name_snap, v_unit, v_qty, v_line,
        nullif(v_item->>'notes',''),
        coalesce(v_item->'customization','null'::jsonb),
        v_addon);

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
  end if;

  -- promo / manual discount
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

notify pgrst, 'reload schema';
