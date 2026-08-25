-- =====================================================================
-- BEVI & GO — Phase 51
-- Allow editing today's starting cash after it was set (or missed).
-- Barista (own shift) and admin/developer can correct it.
-- The amount is always stored on the day's DECLARING shift (the shift
-- that already holds a starting cash, else the earliest shift of the day)
-- so the drawer stays a single value per business date.
-- =====================================================================

create or replace function public.tc_edit_starting_cash(
  p_amount numeric,
  p_shift_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_s public.shifts%rowtype;
  v_target uuid;
  v_is_admin boolean;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'amount must be >= 0'; end if;

  v_is_admin := public.has_role(v_actor, 'admin') or public.has_role(v_actor, 'developer');

  if p_shift_id is not null then
    select * into v_s from public.shifts where id = p_shift_id;
  else
    select * into v_s from public.shifts
     where user_id = v_actor
     order by clock_in desc limit 1;
  end if;
  if v_s.id is null then raise exception 'no shift found'; end if;

  if v_s.user_id <> v_actor and not v_is_admin then
    raise exception 'not authorized';
  end if;

  -- Find the shift that carries the day's declared drawer.
  select id into v_target
    from public.shifts
   where business_date = v_s.business_date
     and coalesce(starting_cash, 0) > 0
   order by clock_in asc limit 1;

  if v_target is null then
    select id into v_target
      from public.shifts
     where business_date = v_s.business_date
     order by clock_in asc limit 1;
  end if;

  -- Keep exactly one declaring shift per business date.
  update public.shifts set starting_cash = 0
   where business_date = v_s.business_date and id <> v_target
     and coalesce(starting_cash, 0) <> 0;

  update public.shifts set starting_cash = p_amount where id = v_target;

  return jsonb_build_object('ok', true, 'starting_cash', p_amount, 'shift_id', v_target);
end $$;

grant execute on function public.tc_edit_starting_cash(numeric, uuid) to authenticated;

notify pgrst, 'reload schema';
