-- =====================================================================
-- BEVI & GO — Phase 37: Category edit/delete + drag-reorder + Favorites
-- Adds is_favorite column, reorder RPCs, favorite-toggle RPC and
-- category CRUD RPCs so baristas can maintain menu presentation from POS.
-- Idempotent. Run after phase 36.
-- =====================================================================

alter table public.menu_items
  add column if not exists is_favorite boolean not null default false;

create index if not exists menu_items_is_favorite_idx
  on public.menu_items(is_favorite) where is_favorite = true;

-- Reload the customer-facing menu view so is_favorite propagates (harmless
-- if public_menu doesn't reference it directly).
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Toggle favorite (staff only)
-- ---------------------------------------------------------------------
create or replace function public.pos_toggle_favorite(p_item_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;
  update public.menu_items
     set is_favorite = coalesce(p_value, false),
         updated_at = now()
   where id = p_item_id;
end
$$;
revoke all on function public.pos_toggle_favorite(uuid, boolean) from public, anon;
grant execute on function public.pos_toggle_favorite(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Reorder categories (staff only)
-- ---------------------------------------------------------------------
create or replace function public.pos_reorder_categories(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  i int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;
  if p_ids is null then return; end if;
  for i in 1 .. array_length(p_ids, 1) loop
    update public.categories set sort_order = i where id = p_ids[i];
  end loop;
end
$$;
revoke all on function public.pos_reorder_categories(uuid[]) from public, anon;
grant execute on function public.pos_reorder_categories(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Reorder menu items (staff only)
-- ---------------------------------------------------------------------
create or replace function public.pos_reorder_menu_items(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  i int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.is_staff(v_actor) then raise exception 'not authorized'; end if;
  if p_ids is null then return; end if;
  for i in 1 .. array_length(p_ids, 1) loop
    update public.menu_items set sort_order = i, updated_at = now() where id = p_ids[i];
  end loop;
end
$$;
revoke all on function public.pos_reorder_menu_items(uuid[]) from public, anon;
grant execute on function public.pos_reorder_menu_items(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Rename & delete categories (admin/developer only)
-- ---------------------------------------------------------------------
create or replace function public.admin_rename_category(p_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not (public.has_role(v_actor, 'admin') or public.has_role(v_actor, 'developer')) then
    raise exception 'only admin or developer can rename categories';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name is required'; end if;
  update public.categories set name = trim(p_name) where id = p_id;
end
$$;
revoke all on function public.admin_rename_category(uuid, text) from public, anon;
grant execute on function public.admin_rename_category(uuid, text) to authenticated;

create or replace function public.admin_delete_category(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not (public.has_role(v_actor, 'admin') or public.has_role(v_actor, 'developer')) then
    raise exception 'only admin or developer can delete categories';
  end if;

  select count(*) into v_count from public.menu_items where category_id = p_id;
  if v_count > 0 then
    -- Detach items instead of blocking; they become uncategorized.
    update public.menu_items set category_id = null where category_id = p_id;
  end if;

  delete from public.categories where id = p_id;
end
$$;
revoke all on function public.admin_delete_category(uuid) from public, anon;
grant execute on function public.admin_delete_category(uuid) to authenticated;

notify pgrst, 'reload schema';
