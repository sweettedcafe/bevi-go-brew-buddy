-- Phase 48: bundle components can offer MULTIPLE variant choices
-- (e.g. "any classic cookie" + "any refresher"), customer/barista picks one pair.
-- Run in the Supabase SQL editor.

-- 1) Allowed variant choices per bundle component ---------------------------
alter table public.bundle_items
  add column if not exists variant_ids uuid[];

-- backfill from the single-variant column
update public.bundle_items
   set variant_ids = array[variant_id]
 where variant_ids is null and variant_id is not null;

-- 2) public_menu exposes bundle_item id + allowed variant choices -----------
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
        'id', bi.id,
        'bundle_id', bi.bundle_id, 'menu_item_id', bi.menu_item_id, 'qty', bi.qty,
        'variant_id', bi.variant_id,
        'variant_ids', coalesce(bi.variant_ids, case when bi.variant_id is null
                                then '{}'::uuid[] else array[bi.variant_id] end),
        'discount_type', bi.discount_type, 'discount_value', bi.discount_value
      )) from public.bundle_items bi
      where exists (select 1 from public.bundles b
                    where b.id = bi.bundle_id and b.is_active)), '[]'::jsonb)
  );
$$;
grant execute on function public.public_menu() to anon, authenticated;

-- 3) customer_self_order honours per-component variant choices --------------
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
  v_choice uuid; v_allowed uuid[]; v_cv public.menu_item_variants%rowtype;
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
      select bi.id, bi.menu_item_id, bi.qty, bi.variant_id, bi.variant_ids,
             bi.discount_type, bi.discount_value,
             mi.name, mi.price, v.name as variant_name, v.price as variant_price
        from public.bundle_items bi
        join public.menu_items mi on mi.id = bi.menu_item_id and mi.is_active
        left join public.menu_item_variants v on v.id = bi.variant_id
       where bi.bundle_id = v_b.id
    loop
      -- allowed variant choices for this component
      v_allowed := coalesce(v_bi.variant_ids,
                     case when v_bi.variant_id is null then '{}'::uuid[]
                          else array[v_bi.variant_id] end);
      -- the choice the customer made (if any)
      v_choice := nullif((
        select c->>'variant_id'
          from jsonb_array_elements(coalesce(v_bundle->'choices','[]'::jsonb)) c
         where (c->>'bundle_item_id')::uuid = v_bi.id
         limit 1), '')::uuid;

      v_variant_id := v_bi.variant_id;
      v_bbase := coalesce(v_bi.variant_price, v_bi.price);
      v_bname := case when v_bi.variant_name is null then v_bi.name
                      else v_bi.name || ' — ' || v_bi.variant_name end;

      if v_choice is not null then
        if array_length(v_allowed, 1) is not null and not (v_choice = any (v_allowed)) then
          raise exception 'variant not allowed for this bundle';
        end if;
        select * into v_cv from public.menu_item_variants where id = v_choice and is_active;
        if not found then raise exception 'variant unavailable'; end if;
        v_variant_id := v_cv.id;
        v_bbase := v_cv.price;
        v_bname := v_bi.name || ' — ' || v_cv.name;
      elsif array_length(v_allowed, 1) > 1 then
        raise exception 'please choose a variant for %', v_bi.name;
      end if;

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
      values (v_order_id, v_bi.menu_item_id, v_variant_id, v_bname,
        v_bprice, v_bi.qty * v_bqty, v_line,
        'Bundle: '||v_b.name, 'null'::jsonb, 0);
    end loop;
  end loop;

  update public.orders set subtotal = v_subtotal, total = v_subtotal where id = v_order_id;
  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_subtotal);
end $$;
grant execute on function public.customer_self_order(text, jsonb) to anon, authenticated;
