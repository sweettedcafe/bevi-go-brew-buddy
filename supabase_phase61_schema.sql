-- =====================================================================
-- Phase 61 — Barista PINs, Partner menu editing, Deposit wipe
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- 1. Barista 4-digit PINs ----------------------------------
create table if not exists public.barista_pins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);
grant all on public.barista_pins to service_role;
alter table public.barista_pins enable row level security;
-- No direct table access; only the functions below touch it.

-- The signed-in user (verified with their account password) sets their own PIN.
create or replace function public.pos_set_my_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be exactly 4 digits'; end if;
  insert into public.barista_pins(user_id, pin_hash, updated_at)
  values (auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf')), now())
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.pos_set_my_pin(text) from public, anon;
grant execute on function public.pos_set_my_pin(text) to authenticated;

create or replace function public.pos_verify_pin(p_user_id uuid, p_pin text)
returns boolean language sql security definer set search_path = public, extensions as $$
  select public.is_staff(auth.uid()) and exists (
    select 1 from public.barista_pins b
     where b.user_id = p_user_id and b.pin_hash = extensions.crypt(p_pin, b.pin_hash));
$$;
revoke all on function public.pos_verify_pin(uuid, text) from public, anon;
grant execute on function public.pos_verify_pin(uuid, text) to authenticated;

create or replace function public.pos_pin_status()
returns setof uuid language sql security definer set search_path = public as $$
  select user_id from public.barista_pins where public.is_staff(auth.uid());
$$;
revoke all on function public.pos_pin_status() from public, anon;
grant execute on function public.pos_pin_status() to authenticated;

-- Admin/developer can clear someone's PIN so they can set it up again.
create or replace function public.pos_clear_pin(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')) then
    raise exception 'only admins can clear PINs';
  end if;
  delete from public.barista_pins where user_id = p_user_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.pos_clear_pin(uuid) from public, anon;
grant execute on function public.pos_clear_pin(uuid) to authenticated;

-- ---------- 2. Partner can edit Menu & Recipes ------------------------
do $$
declare t text;
begin
  foreach t in array array['categories','menu_items','recipes','menu_item_variants','variant_recipes','owners'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists "partner menu write" on public.%I', t);
      execute format('create policy "partner menu write" on public.%I for all to authenticated
        using (public.has_role(auth.uid(),''partner'')) with check (public.has_role(auth.uid(),''partner''))', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

drop policy if exists "partner menu images write" on storage.objects;
create policy "partner menu images write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and public.has_role(auth.uid(),'partner'));
drop policy if exists "partner menu images update" on storage.objects;
create policy "partner menu images update" on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and public.has_role(auth.uid(),'partner'));

-- ---------- 3. Wipe deposits (developer only) -------------------------
create or replace function public.dev_wipe_deposits()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.has_role(auth.uid(),'developer') then
    raise exception 'only developers can wipe deposits';
  end if;
  delete from public.shift_expenses where lower(coalesce(category,'')) like '%deposit%';
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'deleted_deposits', v_count);
end $$;
revoke all on function public.dev_wipe_deposits() from public, anon;
grant execute on function public.dev_wipe_deposits() to authenticated;

notify pgrst, 'reload schema';
