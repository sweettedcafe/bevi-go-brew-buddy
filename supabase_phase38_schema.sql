-- =====================================================================
-- BEVI & GO — Phase 38
--  1) Business date is Manila time (fixes "yesterday merged into today")
--  2) Customer self-order honours variants (fixes ₱ showing extras only)
--  3) Bundles can pick a specific variant per component
--  4) Held orders: delete + auto-purge previous days
--  5) Today's orders: "Claimed" tagging (barista tick / customer stop alert)
--  6) Starting cash moved out of Time in → set once on End of Shift
--  7) Admin-managed expense categories
-- Idempotent; safe to re-run.
-- =====================================================================

-- ---------- 1. Manila business date ----------------------------------
create or replace function public._set_business_date_manila()
returns trigger language plpgsql as $$
begin
  new.business_date := (now() at time zone 'Asia/Manila')::date;
  return new;
end $$;

drop trigger if exists orders_business_date_manila on public.orders;
create trigger orders_business_date_manila
  before insert on public.orders
  for each row execute function public._set_business_date_manila();

-- ---------- 2. Bundle components can target a variant ----------------
alter table public.bundle_items
  add column if not exists variant_id uuid references public.menu_item_variants(id) on delete set null;

-- public_menu must expose it (customer page prices bundles client-side)
create or replace function public.public_menu()
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'sort_order', c.sort_order
      ) order by c.sort_order) from public.categories c where c.is_active), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'category_id', m.category_id, 'name', m.name,
        'description', m.description, 'price', m.price, 'options', m.options,
        'has_variants', m.has_variants, 'image_url', m.image_url
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
        'variant_id', bi.variant_id,
        'discount_type', bi.discount_type, 'discount_value', bi.discount_value
      )) from public.bundle_items bi
      where exists (select 1 from public.bundles b
                    where b.id = bi.bundle_id and b.is_active)), '[]'::jsonb)
  );
$$;
grant execute on function public.public_menu() to anon, authenticated;

-- ---------- 3. customer_self_order honours variants ------------------
create or replace function public.customer_self_order(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_c public.customers%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_order_id uuid; v_order_no int;
  v_subtotal numeric(10,2) := 0;
  v_item jsonb; v_mi public.menu_items%rowtype;
  v_qty int; v_unit numeric(10,2); v_addon numeric(10,2); v_line numeric(10,2);
  v_base numeric(10,2); v_name text;
  v_variant_id uuid; v_variant public.menu_item_variants%rowtype;
  v_attempts int := 0;
  v_bundle jsonb; v_b public.bundles%rowtype; v_bi record;
  v_bqty int; v_bprice numeric(10,2); v_bbase numeric(10,2); v_bname text;
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
    v_variant_id := nullif(v_item->>'variant_id','')::uuid;
    v_base := v_mi.price;
    v_name := v_mi.name;
    if v_variant_id is not null then
      select * into v_variant from public.menu_item_variants where id = v_variant_id;
      if not found then raise exception 'variant unavailable'; end if;
      v_base := v_variant.price;
      v_name := v_mi.name || ' — ' || v_variant.name;
    end if;

    v_unit := v_base + v_addon;
    v_line := round(v_unit * v_qty, 2);
    v_subtotal := v_subtotal + v_line;
    insert into public.order_items(order_id, menu_item_id, variant_id, name_snapshot,
      unit_price, qty, line_total, notes, customization, addon_total, is_upsell)
    values (v_order_id, v_mi.id, v_variant_id, v_name, v_unit, v_qty, v_line,
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
      select bi.menu_item_id, bi.qty, bi.variant_id, bi.discount_type, bi.discount_value,
             mi.name, mi.price, v.name as variant_name, v.price as variant_price
        from public.bundle_items bi
        join public.menu_items mi on mi.id = bi.menu_item_id and mi.is_active
        left join public.menu_item_variants v on v.id = bi.variant_id
       where bi.bundle_id = v_b.id
    loop
      v_bbase := coalesce(v_bi.variant_price, v_bi.price);
      v_bname := case when v_bi.variant_name is null then v_bi.name
                      else v_bi.name || ' — ' || v_bi.variant_name end;
      v_bprice := case
        when v_bi.discount_type = 'percent'
          then greatest(0, v_bbase - v_bbase * coalesce(v_bi.discount_value,0) / 100)
        else greatest(0, v_bbase - coalesce(v_bi.discount_value,0))
      end;
      v_bprice := round(v_bprice, 2);
      v_line := round(v_bprice * v_bi.qty * v_bqty, 2);
      v_subtotal := v_subtotal + v_line;
      insert into public.order_items(order_id, menu_item_id, variant_id, name_snapshot,
        unit_price, qty, line_total, notes, customization, addon_total)
      values (v_order_id, v_bi.menu_item_id, v_bi.variant_id, v_bname,
        v_bprice, v_bi.qty * v_bqty, v_line,
        'Bundle: '||v_b.name, 'null'::jsonb, 0);
    end loop;
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;
  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_subtotal);
end $$;
grant execute on function public.customer_self_order(text, jsonb) to anon, authenticated;

-- ---------- 4. Held orders: delete + purge old ------------------------
create or replace function public.pos_delete_held(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;
  delete from public.order_items where order_id = p_order_id;
  delete from public.orders where id = p_order_id and status = 'on_hold';
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.pos_delete_held(uuid) to authenticated;

create or replace function public.pos_purge_stale_holds()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_n int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;
  delete from public.order_items oi
   using public.orders o
   where oi.order_id = o.id and o.status = 'on_hold' and o.business_date < v_today;
  delete from public.orders where status = 'on_hold' and business_date < v_today;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n);
end $$;
grant execute on function public.pos_purge_stale_holds() to authenticated;

-- ---------- 5. Claimed tagging ---------------------------------------
alter table public.orders
  add column if not exists claimed_at timestamptz;

create or replace function public.pos_set_claimed(p_order_id uuid, p_value boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;
  update public.orders
     set claimed_at = case when p_value then now() else null end
   where id = p_order_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.pos_set_claimed(uuid, boolean) to authenticated;

-- Customer taps "Stop alert" → order is claimed
create or replace function public.customer_ack_ready(p_token text, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_c public.customers%rowtype; v_key text := public._normalize_customer_token(p_token);
begin
  select * into v_c from public.customers where token = v_key and deleted_at is null;
  if not found then return jsonb_build_object('ok', false); end if;
  update public.orders
     set claimed_at = coalesce(claimed_at, now())
   where id = p_order_id and customer_id = v_c.id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.customer_ack_ready(text, uuid) to anon, authenticated;

-- ---------- 6. Starting cash on End of Shift (set once) ---------------
create or replace function public.tc_set_starting_cash(p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid(); v_s public.shifts%rowtype;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'amount must be >= 0'; end if;
  select * into v_s from public.shifts
   where user_id = v_actor and clock_out is null
   order by clock_in desc limit 1;
  if not found then raise exception 'no open shift'; end if;
  if coalesce(v_s.starting_cash, 0) > 0 then
    raise exception 'starting cash already set for this shift';
  end if;
  update public.shifts set starting_cash = p_amount where id = v_s.id;
  return jsonb_build_object('ok', true, 'starting_cash', p_amount);
end $$;
grant execute on function public.tc_set_starting_cash(numeric) to authenticated;

-- Suggest yesterday's closing cash (starting + cash net − expenses)
create or replace function public.tc_prev_closing_cash()
returns numeric language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_prev date;
  v_start numeric := 0; v_cash numeric := 0; v_exp numeric := 0;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  select max(business_date) into v_prev from public.shifts where business_date < v_today;
  if v_prev is null then return 0; end if;
  select coalesce(sum(starting_cash),0) into v_start from public.shifts where business_date = v_prev;
  select coalesce(sum(p.amount - coalesce(p.change_due,0)),0) into v_cash
    from public.payments p join public.orders o on o.id = p.order_id
   where o.business_date = v_prev and p.method = 'cash'
     and coalesce(o.txn_kind,'sale') = 'sale';
  select coalesce(sum(e.amount),0) into v_exp
    from public.shift_expenses e join public.shifts s on s.id = e.shift_id
   where s.business_date = v_prev;
  return round(v_start + v_cash - v_exp, 2);
end $$;
grant execute on function public.tc_prev_closing_cash() to authenticated;

-- ---------- 7. Admin-managed expense categories -----------------------
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

grant select on public.expense_categories to authenticated;
grant insert, update, delete on public.expense_categories to authenticated;
grant all on public.expense_categories to service_role;

alter table public.expense_categories enable row level security;

drop policy if exists "staff read expense categories" on public.expense_categories;
create policy "staff read expense categories" on public.expense_categories
  for select to authenticated using (public.is_staff(auth.uid()));

drop policy if exists "admin manage expense categories" on public.expense_categories;
create policy "admin manage expense categories" on public.expense_categories
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

insert into public.expense_categories(name, sort_order)
  values ('Supplies',1), ('Utilities',2), ('Transport',3), ('Maintenance',4), ('Other',9)
  on conflict (name) do nothing;

notify pgrst, 'reload schema';
