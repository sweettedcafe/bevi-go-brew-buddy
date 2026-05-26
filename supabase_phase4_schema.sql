-- =====================================================================
-- BEVI & GO — Phase 4: Hold Orders, Drink Labels, Reprint History
-- Run AFTER supabase_phase3_schema.sql.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------- 1. Extend order_status enum with 'on_hold' ----------------
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'on_hold'
      and enumtypid = 'public.order_status'::regtype
  ) then
    alter type public.order_status add value 'on_hold';
  end if;
end $$;

-- ---------- 2. Track who held the order -------------------------------
alter table public.orders
  add column if not exists held_at timestamptz,
  add column if not exists held_by uuid references auth.users(id) on delete set null;

-- ---------- 3. Categories get a "prints_label" flag (drinks) ----------
alter table public.categories
  add column if not exists prints_label boolean not null default false;

-- Seed: mark drink-style categories as label-printable
update public.categories
   set prints_label = true
 where prints_label = false
   and lower(name) in ('coffee','hot coffee','cold drinks','iced','tea','drinks','beverages');

-- ---------- 4. RPC: hold an in-progress cart --------------------------
-- Payload shape:
-- { "order_type":"takeout", "customer_name":"Ahmed", "notes":null,
--   "items":[{"menu_item_id":"<uuid>","qty":2,"notes":null}, ...] }
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
  v_line_total numeric(10,2);
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
    v_line_total := round(v_mi.price * v_qty, 2);
    v_subtotal := v_subtotal + v_line_total;
    insert into public.order_items(order_id, menu_item_id, name_snapshot,
                                   unit_price, qty, line_total, notes)
      values (v_order_id, v_mi.id, v_mi.name, v_mi.price, v_qty, v_line_total,
              nullif(v_item->>'notes',''));
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no);
end; $$;

grant execute on function public.pos_hold_order(jsonb) to authenticated;

-- ---------- 5. RPC: resume (delete the held order, return its contents) ----
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
            'notes', notes
         ) order by created_at), '[]'::jsonb)
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
