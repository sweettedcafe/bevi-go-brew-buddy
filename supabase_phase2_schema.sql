-- =====================================================================
-- BEVI & GO — Phase 2: POS + Menu + Inventory + Recipes + Orders
-- Run AFTER supabase_schema.sql (Phase 1) is already applied.
-- Target project: pwixzaejussrgxanxeyf
-- Timezone for daily order numbering: Asia/Riyadh (change if needed below).
-- =====================================================================

-- ---------- 1. CATEGORIES ---------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  int  not null default 0,
  color       text,                       -- optional hex / oklch tag
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.categories enable row level security;

-- ---------- 2. MENU ITEMS ---------------------------------------------
create table if not exists public.menu_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid references public.categories(id) on delete set null,
  name         text not null,
  description  text,
  price        numeric(10,2) not null check (price >= 0),
  image_url    text,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.menu_items enable row level security;

-- ---------- 3. INVENTORY ITEMS ----------------------------------------
create table if not exists public.inventory_items (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  unit           text not null,            -- e.g. 'g','ml','pcs','shot'
  stock_qty      numeric(14,3) not null default 0,
  low_threshold  numeric(14,3) not null default 0,
  cost_per_unit  numeric(10,4) not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.inventory_items enable row level security;

-- ---------- 4. RECIPES (menu_item -> inventory_item consumption) ------
create table if not exists public.recipes (
  menu_item_id      uuid not null references public.menu_items(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  qty_per_unit      numeric(14,4) not null check (qty_per_unit > 0),
  primary key (menu_item_id, inventory_item_id)
);
alter table public.recipes enable row level security;

-- ---------- 5. INVENTORY MOVEMENTS (audit trail of stock changes) -----
create table if not exists public.inventory_movements (
  id                bigserial primary key,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  delta             numeric(14,3) not null,   -- negative = consumed, positive = restock
  reason            text not null,            -- 'order','restock','adjustment','waste'
  ref_table         text,
  ref_id            text,
  actor_id          uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
alter table public.inventory_movements enable row level security;

-- ---------- 6. DAILY ORDER COUNTER (sequential #001 per day) ----------
create table if not exists public.daily_order_counter (
  business_date date primary key,
  last_seq      int  not null default 0
);
alter table public.daily_order_counter enable row level security;

-- ---------- 7. ORDERS -------------------------------------------------
do $$ begin
  create type public.order_type   as enum ('dine_in','takeout','delivery');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.order_status as enum ('open','completed','voided','refunded');
exception when duplicate_object then null; end $$;

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        int  not null,
  business_date   date not null,
  order_type      public.order_type   not null default 'takeout',
  status          public.order_status not null default 'completed',
  subtotal        numeric(10,2) not null default 0,
  tax             numeric(10,2) not null default 0,
  discount_total  numeric(10,2) not null default 0,
  total           numeric(10,2) not null default 0,
  cashier_id      uuid references auth.users(id) on delete set null,
  customer_name   text,
  notes           text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  unique (business_date, order_no)
);
alter table public.orders enable row level security;
create index if not exists orders_created_at_idx on public.orders(created_at desc);

-- ---------- 8. ORDER ITEMS --------------------------------------------
create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  menu_item_id  uuid references public.menu_items(id) on delete set null,
  name_snapshot text not null,
  unit_price    numeric(10,2) not null,
  qty           int not null check (qty > 0),
  line_total    numeric(10,2) not null,
  notes         text
);
alter table public.order_items enable row level security;
create index if not exists order_items_order_idx on public.order_items(order_id);

-- ---------- 9. ORDER PAYMENTS -----------------------------------------
do $$ begin
  create type public.payment_method as enum ('cash','card','transfer','other');
exception when duplicate_object then null; end $$;

create table if not exists public.order_payments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  method      public.payment_method not null,
  amount      numeric(10,2) not null,
  change_due  numeric(10,2) not null default 0,
  reference   text,
  created_at  timestamptz not null default now()
);
alter table public.order_payments enable row level security;

-- ---------- API PRIVILEGES ---------------------------------------------
-- RLS still controls row-level access; these grants let authenticated app
-- users reach the tables through the API when a policy allows it.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.menu_items to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select, insert, update, delete on public.recipes to authenticated;
grant select, insert on public.inventory_movements to authenticated;
grant select, insert, update on public.daily_order_counter to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert on public.order_items to authenticated;
grant select, insert on public.order_payments to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- 10. RLS POLICIES ------------------------------------------
-- Read: any signed-in staff. Write menu/inventory/recipes: admin+developer.
-- Orders/payments/movements: insert by any staff (POS); read by any staff.

-- helper: any staff
-- (public.is_staff already defined in phase 1)

-- categories
drop policy if exists "cat staff read"  on public.categories;
drop policy if exists "cat admin write" on public.categories;
create policy "cat staff read" on public.categories
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "cat admin write" on public.categories
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

-- menu_items
drop policy if exists "menu staff read"  on public.menu_items;
drop policy if exists "menu admin write" on public.menu_items;
create policy "menu staff read" on public.menu_items
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "menu admin write" on public.menu_items
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

-- inventory_items
drop policy if exists "inv staff read"  on public.inventory_items;
drop policy if exists "inv admin write" on public.inventory_items;
create policy "inv staff read" on public.inventory_items
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "inv admin write" on public.inventory_items
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

-- recipes
drop policy if exists "rec staff read"  on public.recipes;
drop policy if exists "rec admin write" on public.recipes;
create policy "rec staff read" on public.recipes
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "rec admin write" on public.recipes
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

-- inventory_movements (insert from RPC + restocks; read for staff)
drop policy if exists "mov staff read"   on public.inventory_movements;
drop policy if exists "mov staff insert" on public.inventory_movements;
create policy "mov staff read" on public.inventory_movements
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "mov staff insert" on public.inventory_movements
  for insert to authenticated with check (public.is_staff(auth.uid()));

-- orders / order_items / payments / counter — staff read+insert
drop policy if exists "ord staff read"   on public.orders;
drop policy if exists "ord staff insert" on public.orders;
drop policy if exists "ord admin update" on public.orders;
create policy "ord staff read" on public.orders
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "ord staff insert" on public.orders
  for insert to authenticated with check (public.is_staff(auth.uid()));
create policy "ord admin update" on public.orders
  for update to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

drop policy if exists "oi staff read"   on public.order_items;
drop policy if exists "oi staff insert" on public.order_items;
create policy "oi staff read" on public.order_items
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "oi staff insert" on public.order_items
  for insert to authenticated with check (public.is_staff(auth.uid()));

drop policy if exists "op staff read"   on public.order_payments;
drop policy if exists "op staff insert" on public.order_payments;
create policy "op staff read" on public.order_payments
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "op staff insert" on public.order_payments
  for insert to authenticated with check (public.is_staff(auth.uid()));

drop policy if exists "doc staff read"   on public.daily_order_counter;
create policy "doc staff read" on public.daily_order_counter
  for select to authenticated using (public.is_staff(auth.uid()));

-- ---------- 11. ATOMIC ORDER CREATION RPC -----------------------------
-- Input JSON shape:
-- {
--   "order_type": "takeout" | "dine_in" | "delivery",
--   "customer_name": null,
--   "notes": null,
--   "items": [{ "menu_item_id":"uuid","qty":1,"notes":null }, ...],
--   "payments": [{ "method":"cash","amount":50,"change_due":2.50,"reference":null }, ...]
-- }
create or replace function public.pos_create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_tz          text := 'Asia/Riyadh';  -- adjust here if needed
  v_today       date := (now() at time zone v_tz)::date;
  v_next_seq    int;
  v_order_id    uuid;
  v_order_no    int;
  v_subtotal    numeric(10,2) := 0;
  v_item        jsonb;
  v_mi          public.menu_items%rowtype;
  v_qty         int;
  v_line_total  numeric(10,2);
  v_recipe      record;
  v_payment     jsonb;
  v_paid_total  numeric(10,2) := 0;
  v_order_type  public.order_type;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_staff(v_actor) then
    raise exception 'not authorized';
  end if;

  v_order_type := coalesce((p_payload->>'order_type')::public.order_type, 'takeout');

  -- next daily seq (atomic upsert)
  insert into public.daily_order_counter(business_date, last_seq)
    values (v_today, 1)
    on conflict (business_date) do update set last_seq = public.daily_order_counter.last_seq + 1
    returning last_seq into v_next_seq;
  v_order_no := v_next_seq;

  -- create order shell
  insert into public.orders(order_no, business_date, order_type, status,
                            subtotal, tax, discount_total, total,
                            cashier_id, customer_name, notes, completed_at)
    values (v_order_no, v_today, v_order_type, 'completed',
            0, 0, 0, 0,
            v_actor, nullif(p_payload->>'customer_name',''), nullif(p_payload->>'notes',''), now())
    returning id into v_order_id;

  -- items + inventory deduction
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty <= 0 then continue; end if;

    select * into v_mi from public.menu_items where id = (v_item->>'menu_item_id')::uuid;
    if not found then
      raise exception 'menu item % not found', v_item->>'menu_item_id';
    end if;

    v_line_total := round(v_mi.price * v_qty, 2);
    v_subtotal   := v_subtotal + v_line_total;

    insert into public.order_items(order_id, menu_item_id, name_snapshot,
                                   unit_price, qty, line_total, notes)
      values (v_order_id, v_mi.id, v_mi.name, v_mi.price, v_qty, v_line_total,
              nullif(v_item->>'notes',''));

    -- deduct inventory per recipe
    for v_recipe in
      select inventory_item_id, qty_per_unit from public.recipes where menu_item_id = v_mi.id
    loop
      update public.inventory_items
         set stock_qty = stock_qty - (v_recipe.qty_per_unit * v_qty),
             updated_at = now()
       where id = v_recipe.inventory_item_id;
      insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
        values (v_recipe.inventory_item_id, -(v_recipe.qty_per_unit * v_qty),
                'order','orders', v_order_id::text, v_actor);
    end loop;
  end loop;

  -- finalize totals (no tax/discount in Phase 2 core)
  update public.orders
     set subtotal = v_subtotal,
         total    = v_subtotal
   where id = v_order_id;

  -- payments
  for v_payment in select * from jsonb_array_elements(coalesce(p_payload->'payments','[]'::jsonb)) loop
    insert into public.order_payments(order_id, method, amount, change_due, reference)
      values (v_order_id,
              (v_payment->>'method')::public.payment_method,
              (v_payment->>'amount')::numeric,
              coalesce((v_payment->>'change_due')::numeric, 0),
              nullif(v_payment->>'reference',''));
    v_paid_total := v_paid_total + (v_payment->>'amount')::numeric;
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_no', v_order_no,
    'business_date', v_today,
    'subtotal', v_subtotal,
    'total', v_subtotal,
    'paid_total', v_paid_total
  );
end; $$;

grant execute on function public.pos_create_order(jsonb) to authenticated;

-- =====================================================================
-- SEED DATA — sample coffee shop menu + inventory + recipes
-- Idempotent: safe to re-run.
-- =====================================================================
do $$
declare
  c_coffee uuid; c_tea uuid; c_pastry uuid; c_cold uuid;
  i_espresso uuid; i_milk uuid; i_water uuid; i_teabag uuid;
  i_choco uuid; i_croissant uuid; i_muffin uuid; i_cookie uuid;
  i_cup12 uuid; i_cup16 uuid; i_lid uuid;
  m record;
begin
  -- categories
  insert into public.categories(name, sort_order) values
    ('Hot Coffee', 1),('Cold Drinks', 2),('Tea', 3),('Pastries', 4)
    on conflict do nothing;
  select id into c_coffee from public.categories where name='Hot Coffee';
  select id into c_cold   from public.categories where name='Cold Drinks';
  select id into c_tea    from public.categories where name='Tea';
  select id into c_pastry from public.categories where name='Pastries';

  -- inventory
  insert into public.inventory_items(name, unit, stock_qty, low_threshold, cost_per_unit) values
    ('Espresso beans','g', 5000, 500, 0.05),
    ('Milk','ml', 20000, 2000, 0.003),
    ('Water','ml', 50000, 5000, 0.0001),
    ('Tea bag','pcs', 200, 30, 0.20),
    ('Chocolate syrup','ml', 2000, 200, 0.02),
    ('Croissant','pcs', 40, 10, 1.50),
    ('Muffin','pcs', 30, 8, 1.20),
    ('Cookie','pcs', 60, 15, 0.60),
    ('Cup 12oz','pcs', 500, 50, 0.10),
    ('Cup 16oz','pcs', 500, 50, 0.12),
    ('Lid','pcs', 800, 100, 0.04)
    on conflict (name) do nothing;
  select id into i_espresso  from public.inventory_items where name='Espresso beans';
  select id into i_milk      from public.inventory_items where name='Milk';
  select id into i_water     from public.inventory_items where name='Water';
  select id into i_teabag    from public.inventory_items where name='Tea bag';
  select id into i_choco     from public.inventory_items where name='Chocolate syrup';
  select id into i_croissant from public.inventory_items where name='Croissant';
  select id into i_muffin    from public.inventory_items where name='Muffin';
  select id into i_cookie    from public.inventory_items where name='Cookie';
  select id into i_cup12     from public.inventory_items where name='Cup 12oz';
  select id into i_cup16     from public.inventory_items where name='Cup 16oz';
  select id into i_lid       from public.inventory_items where name='Lid';

  -- menu items
  insert into public.menu_items(category_id, name, description, price, sort_order) values
    (c_coffee, 'Espresso',        'Single shot',                       8.00, 1),
    (c_coffee, 'Americano',       'Espresso + hot water',              10.00, 2),
    (c_coffee, 'Cappuccino',      'Espresso with steamed milk foam',   14.00, 3),
    (c_coffee, 'Latte',           'Espresso with steamed milk',        15.00, 4),
    (c_coffee, 'Mocha',           'Latte with chocolate',              17.00, 5),
    (c_coffee, 'Flat White',      'Double ristretto + microfoam',      15.00, 6),
    (c_cold,   'Iced Latte',      'Espresso + cold milk over ice',     16.00, 1),
    (c_cold,   'Iced Americano',  'Espresso over ice',                 11.00, 2),
    (c_cold,   'Iced Mocha',      'Iced latte with chocolate',         18.00, 3),
    (c_tea,    'Black Tea',       'Classic',                            8.00, 1),
    (c_tea,    'Green Tea',       'Light & fresh',                      8.00, 2),
    (c_pastry, 'Butter Croissant','Flaky & golden',                    10.00, 1),
    (c_pastry, 'Blueberry Muffin','House baked',                       12.00, 2),
    (c_pastry, 'Chocolate Cookie','Soft baked',                         7.00, 3)
    on conflict do nothing;

  -- recipes (idempotent: clear+reinsert per menu item only if no recipe yet)
  for m in select id, name from public.menu_items loop
    if exists (select 1 from public.recipes where menu_item_id = m.id) then
      continue;
    end if;
    if m.name in ('Espresso')                                        then
      insert into public.recipes values (m.id, i_espresso, 8), (m.id, i_water, 30), (m.id, i_cup12, 1);
    elsif m.name in ('Americano')                                    then
      insert into public.recipes values (m.id, i_espresso, 14), (m.id, i_water, 200), (m.id, i_cup12, 1), (m.id, i_lid, 1);
    elsif m.name in ('Cappuccino','Flat White')                      then
      insert into public.recipes values (m.id, i_espresso, 14), (m.id, i_milk, 150), (m.id, i_cup12, 1), (m.id, i_lid, 1);
    elsif m.name in ('Latte')                                        then
      insert into public.recipes values (m.id, i_espresso, 14), (m.id, i_milk, 220), (m.id, i_cup16, 1), (m.id, i_lid, 1);
    elsif m.name in ('Mocha')                                        then
      insert into public.recipes values (m.id, i_espresso, 14), (m.id, i_milk, 200), (m.id, i_choco, 20), (m.id, i_cup16, 1), (m.id, i_lid, 1);
    elsif m.name in ('Iced Latte')                                   then
      insert into public.recipes values (m.id, i_espresso, 14), (m.id, i_milk, 200), (m.id, i_cup16, 1), (m.id, i_lid, 1);
    elsif m.name in ('Iced Americano')                               then
      insert into public.recipes values (m.id, i_espresso, 14), (m.id, i_water, 150), (m.id, i_cup16, 1), (m.id, i_lid, 1);
    elsif m.name in ('Iced Mocha')                                   then
      insert into public.recipes values (m.id, i_espresso, 14), (m.id, i_milk, 180), (m.id, i_choco, 20), (m.id, i_cup16, 1), (m.id, i_lid, 1);
    elsif m.name in ('Black Tea','Green Tea')                        then
      insert into public.recipes values (m.id, i_teabag, 1), (m.id, i_water, 250), (m.id, i_cup12, 1), (m.id, i_lid, 1);
    elsif m.name = 'Butter Croissant'                                then
      insert into public.recipes values (m.id, i_croissant, 1);
    elsif m.name = 'Blueberry Muffin'                                then
      insert into public.recipes values (m.id, i_muffin, 1);
    elsif m.name = 'Chocolate Cookie'                                then
      insert into public.recipes values (m.id, i_cookie, 1);
    end if;
  end loop;
end $$;
