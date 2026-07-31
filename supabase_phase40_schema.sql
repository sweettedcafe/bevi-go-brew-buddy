-- =====================================================================
-- BEVI & GO — Phase 40
-- 1) New role: accountant (reports + expenses, read-only)
-- 2) Barista may add AND deduct inventory packs
-- Run the whole file. Safe to re-run.
-- =====================================================================

-- ---------- 1. ACCOUNTANT ROLE ---------------------------------------
-- NOTE: enum values cannot be used in the same transaction they are added,
-- so this statement must be committed before any function below uses it.
-- (Supabase SQL editor auto-commits each statement — you're fine.)
alter type public.app_role add value if not exists 'accountant';

-- ---------- 2. INVENTORY: barista add / deduct packs ------------------
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
  if not public.is_staff(v_actor) then raise exception 'staff only'; end if;
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
     set stock_qty  = stock_qty + v_added,
         updated_at = now()
   where id = p_item_id;

  insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
    values (p_item_id, v_added, 'restock', 'inventory_add_packs', null, v_actor);

  return jsonb_build_object('ok', true, 'added_units', v_added,
    'packs', p_packs, 'pack_size', v_it.pack_size);
end $$;

create or replace function public.inventory_remove_packs(
  p_item_id uuid, p_packs numeric, p_reason text default 'adjustment'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := auth.uid();
  v_it public.inventory_items%rowtype;
  v_removed numeric;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'staff only'; end if;
  if p_packs is null or p_packs <= 0 then
    raise exception 'packs must be > 0';
  end if;
  select * into v_it from public.inventory_items where id = p_item_id;
  if not found then raise exception 'inventory item not found'; end if;
  if coalesce(v_it.pack_size, 0) <= 0 then
    raise exception 'pack_size not configured for %', v_it.name;
  end if;

  v_removed := p_packs * v_it.pack_size;
  if v_removed > coalesce(v_it.stock_qty, 0) then
    raise exception 'cannot deduct % % — only % % in stock',
      v_removed, v_it.unit, coalesce(v_it.stock_qty,0), v_it.unit;
  end if;

  update public.inventory_items
     set stock_qty  = stock_qty - v_removed,
         updated_at = now()
   where id = p_item_id;

  insert into public.inventory_movements(inventory_item_id, delta, reason, ref_table, ref_id, actor_id)
    values (p_item_id, -v_removed, coalesce(nullif(p_reason,''),'adjustment'),
            'inventory_remove_packs', null, v_actor);

  return jsonb_build_object('ok', true, 'removed_units', v_removed,
    'packs', p_packs, 'pack_size', v_it.pack_size);
end $$;

grant execute on function public.inventory_add_packs(uuid, numeric) to authenticated;
grant execute on function public.inventory_remove_packs(uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';

-- ---------- 3. ACCOUNTANT READ ACCESS --------------------------------
-- Uses role::text so it works even in the same transaction that added the
-- enum value above.
create or replace function public.is_accountant(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role::text = 'accountant'
  );
$$;
grant execute on function public.is_accountant(uuid) to authenticated;

drop policy if exists "exp accountant read" on public.shift_expenses;
create policy "exp accountant read" on public.shift_expenses
  for select to authenticated using (public.is_accountant(auth.uid()));

notify pgrst, 'reload schema';
