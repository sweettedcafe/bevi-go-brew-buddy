-- Phase 67: Partner gets full edit access to Inventory
drop policy if exists "inv admin write" on public.inventory_items;
create policy "inv admin write" on public.inventory_items
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')
         or exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'partner'));

-- CSV import now allowed for partner too
-- Behaviour: upsert by lower(name). Numeric stock_qty is ADDED to existing
-- stock (append/restock semantics), other fields overwrite when provided.
create or replace function public.inventory_import(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row   jsonb;
  v_id    uuid;
  v_name  text;
  v_added int := 0;
  v_upd   int := 0;
  v_delta numeric(14,3);
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not (public.has_role(v_actor,'admin') or public.has_role(v_actor,'developer') or exists (select 1 from public.user_roles where user_id = v_actor and role::text = 'partner')) then
    raise exception 'admin or partner only';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'rows','[]'::jsonb)) loop
    v_name := nullif(trim(v_row->>'name'),'');
    if v_name is null then continue; end if;
    v_delta := coalesce((v_row->>'stock_qty')::numeric, 0);

    select id into v_id from public.inventory_items where lower(name) = lower(v_name);

    if v_id is null then
      insert into public.inventory_items(name, unit, pack_size, pack_label,
        stock_qty, low_threshold, full_stock_qty, cost_per_unit)
      values (v_name,
              coalesce(nullif(v_row->>'unit',''),'pcs'),
              coalesce((v_row->>'pack_size')::numeric, 1),
              nullif(v_row->>'pack_label',''),
              v_delta,
              coalesce((v_row->>'low_threshold')::numeric, 0),
              coalesce((v_row->>'full_stock_qty')::numeric, greatest(v_delta, 1)),
              coalesce((v_row->>'cost_per_unit')::numeric, 0))
      returning id into v_id;
      v_added := v_added + 1;
    else
      update public.inventory_items
         set stock_qty      = stock_qty + v_delta,
             unit           = coalesce(nullif(v_row->>'unit',''), unit),
             pack_size      = coalesce((v_row->>'pack_size')::numeric, pack_size),
             pack_label     = coalesce(nullif(v_row->>'pack_label',''), pack_label),
             low_threshold  = coalesce((v_row->>'low_threshold')::numeric, low_threshold),
             full_stock_qty = coalesce((v_row->>'full_stock_qty')::numeric, full_stock_qty),
             cost_per_unit  = coalesce((v_row->>'cost_per_unit')::numeric, cost_per_unit),
             updated_at     = now()
       where id = v_id;
      v_upd := v_upd + 1;
    end if;

    if v_delta <> 0 then
      insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
      values (v_id, v_delta, 'import', null, null, v_actor);
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_upd);
end; $$;

grant execute on function public.inventory_import(jsonb) to authenticated;
