-- =====================================================================
-- BEVI & GO — Phase 16
-- 1) Managed Owners (Coffee / Pastry / …) + menu_items.owner_id
-- 2) Void/Refund duplication for accounting (mirror negative txns)
-- 3) Per-item void/refund RPCs (admin, developer, barista)
-- 4) shift_expenses: quantity + unit_price
-- Run after phase 15. Safe to re-run.
-- =====================================================================

-- ---------- 1. OWNERS -------------------------------------------------
create table if not exists public.owners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text,                       -- 'coffee' | 'pastry' | 'other' | free-text
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists owners_name_uniq on public.owners(lower(name));

grant select, insert, update, delete on public.owners to authenticated;
grant all on public.owners to service_role;
alter table public.owners enable row level security;

drop policy if exists "owners read" on public.owners;
create policy "owners read" on public.owners
  for select to authenticated using (true);

drop policy if exists "owners write" on public.owners;
create policy "owners write" on public.owners
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

alter table public.menu_items
  add column if not exists owner_id uuid references public.owners(id) on delete set null;
create index if not exists menu_items_owner_idx on public.menu_items(owner_id);

-- ---------- 2. ORDERS — txn_kind + parent linkage --------------------
alter table public.orders
  add column if not exists parent_order_id uuid references public.orders(id) on delete set null,
  add column if not exists txn_kind text not null default 'sale';

do $$ begin
  alter table public.orders
    add constraint orders_txn_kind_chk check (txn_kind in ('sale','void','refund'));
exception when duplicate_object then null; when others then null; end $$;

create index if not exists orders_parent_idx on public.orders(parent_order_id);
create index if not exists orders_txn_kind_idx on public.orders(txn_kind);

-- order_items: allow negative qty for mirror lines; track parent line.
alter table public.order_items
  add column if not exists parent_item_id uuid references public.order_items(id) on delete set null;

do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.order_items'::regclass and contype = 'c'
  loop
    -- drop the legacy qty > 0 check if present
    if exists (select 1 from pg_constraint
               where conname = r.conname
                 and pg_get_constraintdef(oid) ilike '%qty%>%0%') then
      execute format('alter table public.order_items drop constraint %I', r.conname);
    end if;
  end loop;
end $$;

-- ---------- 3. VOID / REFUND RPCs (mirror negative transactions) -----

-- Reverse inventory for a given menu_item/variant/qty (qty is positive units to restock)
create or replace function public._restock_for_line(
  p_menu_item_id uuid, p_variant_id uuid, p_qty numeric,
  p_reason text, p_ref_order uuid, p_actor uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_r record; v_used_variant boolean := false;
begin
  if p_variant_id is not null then
    for v_r in select inventory_item_id, qty_per_unit from public.variant_recipes
                where variant_id = p_variant_id loop
      v_used_variant := true;
      update public.inventory_items
         set stock_qty = stock_qty + (v_r.qty_per_unit * p_qty), updated_at = now()
       where id = v_r.inventory_item_id;
      insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
        values (v_r.inventory_item_id, (v_r.qty_per_unit * p_qty),
                p_reason, 'orders', p_ref_order::text, p_actor);
    end loop;
  end if;
  if not v_used_variant then
    for v_r in select inventory_item_id, qty_per_unit from public.recipes
                where menu_item_id = p_menu_item_id loop
      update public.inventory_items
         set stock_qty = stock_qty + (v_r.qty_per_unit * p_qty), updated_at = now()
       where id = v_r.inventory_item_id;
      insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
        values (v_r.inventory_item_id, (v_r.qty_per_unit * p_qty),
                p_reason, 'orders', p_ref_order::text, p_actor);
    end loop;
  end if;
end $$;

-- Permission check helper: admin OR developer OR barista
create or replace function public._can_reverse_order(p_uid uuid)
returns boolean language sql stable as $$
  select public.has_role(p_uid,'admin')
      or public.has_role(p_uid,'developer')
      or public.has_role(p_uid,'barista');
$$;

-- Allocate a new order_no for the same business_date
create or replace function public._next_order_no(p_business_date date)
returns int language plpgsql security definer set search_path = public as $$
declare v_no int;
begin
  select coalesce(max(order_no),0) + 1 into v_no from public.orders where business_date = p_business_date;
  return v_no;
end $$;

-- Full void of an order (creates mirror txn_kind='void')
create or replace function public.pos_void_order_v2(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_o public.orders%rowtype;
  v_mirror_id uuid := gen_random_uuid();
  v_it record;
  v_new_item_id uuid;
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
    ) returning id into v_new_item_id;

    perform public._restock_for_line(
      v_it.menu_item_id, v_it.variant_id, v_it.qty, 'void', v_mirror_id, v_actor
    );
  end loop;

  insert into public.order_payments(order_id, method, amount, change_due, reference)
    select v_mirror_id, method, -amount, -change_due, 'VOID' from public.order_payments where order_id = p_order_id;

  update public.orders
     set status = 'voided',
         notes  = coalesce(notes,'') || E'\n[voided by '||v_actor::text||' at '||now()::text||coalesce(' — '||p_reason,'')||']'
   where id = p_order_id;

  return jsonb_build_object('mirror_order_id', v_mirror_id, 'order_no', v_no);
end $$;

-- Full refund of an order (status=refunded, mirror txn_kind='refund')
create or replace function public.pos_refund_order_v2(p_order_id uuid, p_reason text default null)
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
  if v_o.txn_kind <> 'sale' then raise exception 'only sale orders can be refunded'; end if;
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
    'REFUND of #'||v_o.order_no::text||coalesce(' — '||p_reason,''),
    v_o.id, 'refund', now()
  );

  for v_it in select * from public.order_items where order_id = p_order_id loop
    insert into public.order_items(
      order_id, menu_item_id, variant_id, name_snapshot, unit_price, qty, line_total, notes, parent_item_id
    ) values (
      v_mirror_id, v_it.menu_item_id, v_it.variant_id, v_it.name_snapshot,
      v_it.unit_price, -v_it.qty, -v_it.line_total, v_it.notes, v_it.id
    );
    perform public._restock_for_line(
      v_it.menu_item_id, v_it.variant_id, v_it.qty, 'refund', v_mirror_id, v_actor
    );
  end loop;

  insert into public.order_payments(order_id, method, amount, change_due, reference)
    select v_mirror_id, method, -amount, -change_due, 'REFUND' from public.order_payments where order_id = p_order_id;

  update public.orders
     set status = 'refunded',
         notes  = coalesce(notes,'') || E'\n[refunded by '||v_actor::text||' at '||now()::text||coalesce(' — '||p_reason,'')||']'
   where id = p_order_id;

  return jsonb_build_object('mirror_order_id', v_mirror_id, 'order_no', v_no);
end $$;

-- Per-line void / refund (partial). p_qty is the quantity to reverse (positive).
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
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public._can_reverse_order(v_actor) then raise exception 'not authorized'; end if;
  if p_kind not in ('void','refund') then raise exception 'invalid kind'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty must be > 0'; end if;

  select * into v_it from public.order_items where id = p_order_item_id for update;
  if not found then raise exception 'order item not found'; end if;
  select * into v_o from public.orders where id = v_it.order_id for update;
  if v_o.txn_kind <> 'sale' then raise exception 'can only reverse items on sale orders'; end if;

  -- already-reversed quantity on this line
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

  return jsonb_build_object('mirror_order_id', v_mirror_id, 'order_no', v_no, 'qty_reversed', p_qty);
end $$;

create or replace function public.pos_void_order_item(p_order_item_id uuid, p_qty numeric, p_reason text default null)
returns jsonb language sql security definer set search_path=public as $$
  select public._reverse_order_item(p_order_item_id, p_qty, p_reason, 'void');
$$;

create or replace function public.pos_refund_order_item(p_order_item_id uuid, p_qty numeric, p_reason text default null)
returns jsonb language sql security definer set search_path=public as $$
  select public._reverse_order_item(p_order_item_id, p_qty, p_reason, 'refund');
$$;

grant execute on function public.pos_void_order_v2(uuid, text)        to authenticated;
grant execute on function public.pos_refund_order_v2(uuid, text)      to authenticated;
grant execute on function public.pos_void_order_item(uuid, numeric, text)   to authenticated;
grant execute on function public.pos_refund_order_item(uuid, numeric, text) to authenticated;

-- ---------- 4. SHIFT_EXPENSES: quantity + unit_price -----------------
alter table public.shift_expenses
  add column if not exists quantity   numeric not null default 1,
  add column if not exists unit_price numeric;

do $$ begin
  alter table public.shift_expenses
    add constraint shift_expenses_qty_chk check (quantity > 0);
exception when duplicate_object then null; when others then null; end $$;

-- backfill: existing rows -> unit_price=amount, quantity=1
update public.shift_expenses set unit_price = amount where unit_price is null;

-- keep amount in sync with quantity*unit_price
create or replace function public._shift_expenses_sync_amount()
returns trigger language plpgsql as $$
begin
  if new.unit_price is null then new.unit_price := new.amount; end if;
  if new.quantity is null or new.quantity <= 0 then new.quantity := 1; end if;
  new.amount := round(new.quantity * new.unit_price, 2);
  return new;
end $$;

drop trigger if exists shift_expenses_sync_amount on public.shift_expenses;
create trigger shift_expenses_sync_amount
  before insert or update on public.shift_expenses
  for each row execute function public._shift_expenses_sync_amount();

-- Updated RPC accepting qty + unit_price (legacy tc_add_expense still works)
create or replace function public.tc_add_expense_v2(
  p_description text, p_quantity numeric, p_unit_price numeric, p_category text default null
) returns public.shift_expenses
language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_exp public.shift_expenses;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_description),'') = '' then raise exception 'description required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be > 0'; end if;
  if p_unit_price is null or p_unit_price < 0 then raise exception 'unit price must be >= 0'; end if;

  select * into v_shift from public.shifts
   where user_id = auth.uid() and clock_out is null
   order by clock_in desc limit 1;
  if v_shift.id is null then raise exception 'no open shift'; end if;

  insert into public.shift_expenses(shift_id, description, quantity, unit_price, amount, category)
  values (v_shift.id, trim(p_description), p_quantity, p_unit_price,
          round(p_quantity * p_unit_price, 2), nullif(trim(p_category),''))
  returning * into v_exp;
  return v_exp;
end $$;
grant execute on function public.tc_add_expense_v2(text, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
