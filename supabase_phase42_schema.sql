-- =====================================================================
-- BEVI & GO — Phase 42
-- Fix: voiding an order (or an item) consumed a NEW order number, so a
--      void of order #5 appeared as order #6 and the next real sale
--      jumped to #7 — looking like duplicates / broken numbering.
-- Fix: the mirror (negative) transaction now REUSES the parent's
--      order_no. Uniqueness is enforced only across SALE orders, so a
--      void/refund mirror can share the number with its parent.
-- Supersedes the numbering part of Phase 41. Idempotent.
-- =====================================================================

-- ---------- 1. Uniqueness applies to sale orders only -----------------
alter table public.orders
  drop constraint if exists orders_business_date_order_no_key;

drop index if exists public.orders_business_date_order_no_key;
drop index if exists public.orders_sale_no_unique;

create unique index orders_sale_no_unique
  on public.orders (business_date, order_no)
  where coalesce(txn_kind::text, 'sale') = 'sale';

-- ---------- 2. Allocator ignores mirror rows --------------------------
create or replace function public._alloc_order_no(p_date date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_seq int; v_max int;
begin
  insert into public.daily_order_counter(business_date, last_seq)
    values (p_date, 0)
    on conflict (business_date) do nothing;

  perform 1 from public.daily_order_counter where business_date = p_date for update;

  select coalesce(max(order_no), 0) into v_max
    from public.orders
   where business_date = p_date
     and coalesce(txn_kind::text, 'sale') = 'sale';

  update public.daily_order_counter
     set last_seq = greatest(last_seq, v_max) + 1
   where business_date = p_date
   returning last_seq into v_seq;

  return v_seq;
end $$;

grant execute on function public._alloc_order_no(date) to authenticated, anon;

-- ---------- 3. Whole-order void keeps the parent's number -------------
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
  if coalesce(v_o.txn_kind::text,'sale') <> 'sale' then raise exception 'only sale orders can be voided'; end if;
  if v_o.status in ('voided','refunded') then raise exception 'order already %', v_o.status; end if;

  -- Same number as the parent sale: a void of #5 stays #5.
  v_no := v_o.order_no;

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

-- ---------- 4. Per-item reversal keeps the parent's number ------------
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
  if coalesce(v_o.txn_kind::text,'sale') <> 'sale' then raise exception 'can only reverse items on sale orders'; end if;

  select coalesce(sum(-oi.qty),0) into v_qty_done
    from public.order_items oi where oi.parent_item_id = v_it.id;
  v_remaining := v_it.qty - v_qty_done;
  if p_qty > v_remaining then
    raise exception 'cannot reverse %; only % remaining', p_qty, v_remaining;
  end if;

  v_line_total := round(v_it.unit_price * p_qty, 2);
  v_no := v_o.order_no;   -- keep the original order number

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

-- ---------- 5. Re-sync counters against SALE orders only --------------
insert into public.daily_order_counter(business_date, last_seq)
select o.business_date, max(o.order_no)
  from public.orders o
 where coalesce(o.txn_kind::text,'sale') = 'sale'
 group by o.business_date
on conflict (business_date) do update
  set last_seq = greatest(public.daily_order_counter.last_seq, excluded.last_seq);

notify pgrst, 'reload schema';
