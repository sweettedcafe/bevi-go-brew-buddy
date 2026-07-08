-- =====================================================================
-- BEVI & GO — Phase 26
--   1) Customer QR tokens never expire because of is_active=false
--   2) QR functions accept raw tokens or full /o/<token> URLs
--   3) Public registration requires phone + email and reports duplicates
-- Idempotent; run after phase 25.
-- =====================================================================

-- Optional but recommended: prevent new duplicate active phone/email values.
-- If this fails, remove/merge old duplicate customer rows first, then rerun.
create unique index if not exists customers_email_unique_active_idx
  on public.customers (lower(trim(email)))
  where email is not null and trim(email) <> '' and deleted_at is null;

create unique index if not exists customers_phone_unique_active_idx
  on public.customers ((regexp_replace(phone, '\D', '', 'g')))
  where phone is not null and regexp_replace(phone, '\D', '', 'g') <> '' and deleted_at is null;

create or replace function public._normalize_customer_token(p_token text)
returns text language plpgsql immutable as $$
declare v_key text;
begin
  v_key := trim(coalesce(p_token, ''));
  if v_key ~* '^https?://' or v_key like '%/o/%' then
    v_key := regexp_replace(v_key, '^.*/o/', '');
    v_key := split_part(v_key, '?', 1);
    v_key := split_part(v_key, '#', 1);
  end if;
  return trim(v_key);
end $$;

create or replace function public.customer_by_token(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_c public.customers%rowtype; v_key text;
begin
  v_key := public._normalize_customer_token(p_token);
  select * into v_c from public.customers
   where token = v_key
     and deleted_at is null;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_c.id, 'code', v_c.code, 'name', v_c.name,
    'phone', v_c.phone, 'email', v_c.email, 'points', v_c.points
  );
end $$;
grant execute on function public.customer_by_token(text) to anon, authenticated;

drop function if exists public.customer_self_register(text, text, text);
create or replace function public.customer_self_register(
  p_name text, p_phone text default null, p_email text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_code text; v_token text;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if coalesce(trim(p_name),'') = '' then raise exception 'name required'; end if;
  if length(v_phone) < 7 then raise exception 'valid mobile number required'; end if;
  if v_email = '' or v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'valid email required'; end if;

  select id, code, token into v_id, v_code, v_token
    from public.customers
   where deleted_at is null
     and regexp_replace(coalesce(phone,''), '\D', '', 'g') = v_phone
   limit 1;
  if found then
    return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',true,'matched_by','phone');
  end if;

  select id, code, token into v_id, v_code, v_token
    from public.customers
   where deleted_at is null
     and lower(trim(email)) = v_email
   limit 1;
  if found then
    return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',true,'matched_by','email');
  end if;

  v_code  := public._gen_customer_code();
  v_token := public._gen_customer_token();
  insert into public.customers(code, token, name, phone, email, is_active)
    values (v_code, v_token, trim(p_name), trim(p_phone), v_email, true)
    returning id into v_id;
  return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',false);
exception when unique_violation then
  select id, code, token into v_id, v_code, v_token from public.customers
   where deleted_at is null and (
     regexp_replace(coalesce(phone,''), '\D', '', 'g') = v_phone
     or lower(trim(email)) = v_email
   ) limit 1;
  return jsonb_build_object('id',v_id,'code',v_code,'token',v_token,'existed',true,'matched_by','duplicate');
end $$;
grant execute on function public.customer_self_register(text,text,text) to anon, authenticated;

create or replace function public.customer_self_order(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_c public.customers%rowtype;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_order_id uuid; v_order_no int;
  v_subtotal numeric(10,2) := 0;
  v_item jsonb; v_mi public.menu_items%rowtype;
  v_qty int; v_unit numeric(10,2); v_addon numeric(10,2); v_line numeric(10,2);
  v_attempts int := 0;
  v_bundle jsonb; v_b public.bundles%rowtype; v_bi record;
  v_bqty int; v_bprice numeric(10,2);
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

  for v_bundle in select * from jsonb_array_elements(coalesce(p_payload->'bundles','[]'::jsonb)) loop
    v_bqty := coalesce((v_bundle->>'qty')::int, 1);
    if v_bqty <= 0 then continue; end if;
    select * into v_b from public.bundles where id = (v_bundle->>'bundle_id')::uuid and is_active;
    if not found then raise exception 'bundle unavailable'; end if;
    for v_bi in
      select bi.menu_item_id, bi.qty, bi.discount_type, bi.discount_value, mi.name, mi.price
        from public.bundle_items bi
        join public.menu_items mi on mi.id = bi.menu_item_id and mi.is_active
       where bi.bundle_id = v_b.id
    loop
      v_bprice := case
        when v_bi.discount_type = 'percent'
          then greatest(0, v_bi.price - v_bi.price * coalesce(v_bi.discount_value,0) / 100)
        else greatest(0, v_bi.price - coalesce(v_bi.discount_value,0))
      end;
      v_bprice := round(v_bprice, 2);
      v_line := round(v_bprice * v_bi.qty * v_bqty, 2);
      v_subtotal := v_subtotal + v_line;
      insert into public.order_items(order_id, menu_item_id, name_snapshot,
        unit_price, qty, line_total, notes, customization, addon_total)
      values (v_order_id, v_bi.menu_item_id, v_bi.name,
        v_bprice, v_bi.qty * v_bqty, v_line,
        'Bundle: '||v_b.name, 'null'::jsonb, 0);
    end loop;
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;
  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_subtotal);
end $$;
grant execute on function public.customer_self_order(text, jsonb) to anon, authenticated;

create or replace function public.customer_order_status(p_token text, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_c public.customers%rowtype; v_o public.orders%rowtype; v_key text;
begin
  v_key := public._normalize_customer_token(p_token);
  select * into v_c from public.customers where token = v_key and deleted_at is null;
  if not found then return null; end if;
  select * into v_o from public.orders where id = p_order_id and customer_id = v_c.id;
  if not found then return null; end if;
  return jsonb_build_object(
    'order_id', v_o.id,
    'order_no', v_o.order_no,
    'status',   v_o.status,
    'total',    v_o.total
  );
end $$;
grant execute on function public.customer_order_status(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';