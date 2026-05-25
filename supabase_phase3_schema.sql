-- =====================================================================
-- BEVI & GO — Phase 3: Payments & Discounts
-- Run AFTER supabase_phase2_schema.sql.
-- Adds:
--   * discounts table (promo codes + manual discount tracking)
--   * payment_methods configuration table (custom methods + fees)
--   * extends order schema with discount metadata
--   * upgrades pos_create_order RPC to validate split payments,
--     apply promo codes / manual discounts, and bump usage counts.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------- 1. DISCOUNTS ----------------------------------------------
do $$ begin
  create type public.discount_type as enum ('percent','fixed');
exception when duplicate_object then null; end $$;

create table if not exists public.discounts (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                       -- null = manager-only manual discount
  name          text not null,
  type          public.discount_type not null,
  value         numeric(10,2) not null check (value >= 0),
  min_subtotal  numeric(10,2) not null default 0,
  max_uses      int,                               -- null = unlimited
  uses_count    int  not null default 0,
  starts_at     timestamptz,
  ends_at       timestamptz,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.discounts enable row level security;

-- ---------- 2. PAYMENT METHODS CONFIG ---------------------------------
-- Configurable cashier payment buttons; fees recorded per order_payment.
create table if not exists public.payment_methods (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,    -- machine code (e.g. 'cash','mada','stc_pay')
  label        text not null,           -- display label
  kind         public.payment_method not null default 'other', -- maps to enum
  fee_percent  numeric(6,3) not null default 0,
  fee_fixed    numeric(10,2) not null default 0,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.payment_methods enable row level security;

-- ---------- 3. EXTEND ORDERS & PAYMENTS -------------------------------
alter table public.orders
  add column if not exists discount_id    uuid references public.discounts(id) on delete set null,
  add column if not exists discount_code  text,
  add column if not exists discount_label text;

alter table public.order_payments
  add column if not exists method_code text,
  add column if not exists fee_amount  numeric(10,2) not null default 0;

-- ---------- 4. GRANTS --------------------------------------------------
grant select, insert, update, delete on public.discounts       to authenticated;
grant select, insert, update, delete on public.payment_methods to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- 5. RLS POLICIES -------------------------------------------
drop policy if exists "dsc staff read"  on public.discounts;
drop policy if exists "dsc admin write" on public.discounts;
create policy "dsc staff read" on public.discounts
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "dsc admin write" on public.discounts
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

drop policy if exists "pm staff read"  on public.payment_methods;
drop policy if exists "pm admin write" on public.payment_methods;
create policy "pm staff read" on public.payment_methods
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "pm admin write" on public.payment_methods
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

-- ---------- 6. SEED DEFAULT PAYMENT METHODS ---------------------------
insert into public.payment_methods(code, label, kind, fee_percent, fee_fixed, sort_order) values
  ('cash',     'Cash',         'cash',     0,    0, 1),
  ('mada',     'Mada Card',    'card',     0.5,  0, 2),
  ('visa',     'Visa / Master','card',     2.75, 0, 3),
  ('stc_pay',  'STC Pay',      'transfer', 1.0,  0, 4),
  ('apple_pay','Apple Pay',    'card',     1.5,  0, 5),
  ('transfer', 'Bank Transfer','transfer', 0,    0, 6)
  on conflict (code) do nothing;

-- ---------- 7. UPGRADED pos_create_order RPC --------------------------
-- New payload shape:
-- {
--   "order_type": "...",
--   "customer_name": null,
--   "notes": null,
--   "items": [...],
--   "discount_code": "WELCOME10" | null,
--   "manual_discount": { "type":"percent","value":10,"label":"Manager 10%" } | null,
--   "payments": [
--     { "method_code":"cash","amount":50,"change_due":2.50,"reference":null,"fee_amount":0 },
--     ...
--   ]
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
  v_line_total  numeric(10,2);
  v_recipe      record;
  v_payment     jsonb;
  v_paid_total  numeric(10,2) := 0;
  v_order_type  public.order_type;
  v_code        text;
  v_dsc         public.discounts%rowtype;
  v_manual      jsonb;
  v_dsc_label   text;
  v_pm          public.payment_methods%rowtype;
  v_pm_kind     public.payment_method;
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

  -- items + inventory deduction
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    v_qty := coalesce((v_item->>'qty')::int, 1);
    if v_qty <= 0 then continue; end if;
    select * into v_mi from public.menu_items where id = (v_item->>'menu_item_id')::uuid;
    if not found then raise exception 'menu item % not found', v_item->>'menu_item_id'; end if;
    v_line_total := round(v_mi.price * v_qty, 2);
    v_subtotal   := v_subtotal + v_line_total;

    insert into public.order_items(order_id, menu_item_id, name_snapshot,
                                   unit_price, qty, line_total, notes)
      values (v_order_id, v_mi.id, v_mi.name, v_mi.price, v_qty, v_line_total,
              nullif(v_item->>'notes',''));

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
    -- manual discount path
    v_manual := p_payload->'manual_discount';
    if v_manual is not null and jsonb_typeof(v_manual) = 'object' then
      if not (public.has_role(v_actor,'admin') or public.has_role(v_actor,'developer')) then
        raise exception 'manual discount requires admin role';
      end if;
      v_dsc_label := coalesce(v_manual->>'label','Manual discount');
      if (v_manual->>'type') = 'percent' then
        v_discount := round(v_subtotal * (v_manual->>'value')::numeric / 100.0, 2);
      else
        v_discount := least((v_manual->>'value')::numeric, v_subtotal);
      end if;
      update public.orders set discount_label = v_dsc_label where id = v_order_id;
    end if;
  end if;

  v_total := greatest(0, v_subtotal - v_discount);

  update public.orders
     set subtotal       = v_subtotal,
         discount_total = v_discount,
         total          = v_total
   where id = v_order_id;

  -- payments
  for v_payment in select * from jsonb_array_elements(coalesce(p_payload->'payments','[]'::jsonb)) loop
    select * into v_pm from public.payment_methods where code = (v_payment->>'method_code');
    if found then
      v_pm_kind := v_pm.kind;
    else
      v_pm_kind := coalesce((v_payment->>'method')::public.payment_method, 'other');
    end if;
    insert into public.order_payments(order_id, method, method_code, amount, change_due, fee_amount, reference)
      values (v_order_id,
              v_pm_kind,
              nullif(v_payment->>'method_code',''),
              (v_payment->>'amount')::numeric,
              coalesce((v_payment->>'change_due')::numeric, 0),
              coalesce((v_payment->>'fee_amount')::numeric, 0),
              nullif(v_payment->>'reference',''));
    v_paid_total := v_paid_total + (v_payment->>'amount')::numeric - coalesce((v_payment->>'change_due')::numeric, 0);
  end loop;

  if round(v_paid_total,2) < round(v_total,2) then
    raise exception 'underpaid: paid % vs total %', v_paid_total, v_total;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_no', v_order_no,
    'business_date', v_today,
    'subtotal', v_subtotal,
    'discount_total', v_discount,
    'discount_label', v_dsc_label,
    'total', v_total,
    'paid_total', v_paid_total
  );
end; $$;

grant execute on function public.pos_create_order(jsonb) to authenticated;
