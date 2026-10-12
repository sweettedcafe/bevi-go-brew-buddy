-- Phase 59: Starting Balance = ONLY yesterday's (calendar day before) EOD figures, per payment method.
-- No more adding up every past day.
--   Cash:      today's starting cash if set; otherwise yesterday's starting cash + yesterday's cash sales - cash expenses.
--   Others:    yesterday's sales - yesterday's expenses for that method (0 if nothing happened yesterday).
-- Requires supabase_phase53_schema.sql (eos_pm_code, eos_day_by_method).

drop function if exists public.eos_eod_by_method(date);

create or replace function public.tc_eos_balances(p_shift_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts;
  v_date date;
  v_prev date;
  v_cash_code text;
  v_start_cash numeric;
  v_prev_start_cash numeric;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_shift_id is not null then
    select * into v_shift from public.shifts where id = p_shift_id;
  else
    select * into v_shift from public.shifts where user_id = auth.uid() order by clock_in desc limit 1;
  end if;
  if v_shift.id is null then return '[]'::jsonb; end if;
  if v_shift.user_id <> auth.uid()
     and not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
    then raise exception 'not authorized'; end if;

  v_date := v_shift.business_date;
  v_prev := v_date - 1;
  v_cash_code := public.eos_pm_code(null, 'cash');
  select coalesce(sum(starting_cash),0) into v_start_cash from public.shifts where business_date = v_date;
  select coalesce(sum(starting_cash),0) into v_prev_start_cash from public.shifts where business_date = v_prev;

  with yday as (
    select d.code as c, coalesce(d.sales,0) - coalesce(d.expenses,0) as net
      from public.eos_day_by_method(v_prev) d
  ), today as (
    select d.code as c, d.sales, d.expenses from public.eos_day_by_method(v_date) d
  ), base as (
    select pm.code, pm.label, pm.kind, pm.sort_order, pm.is_active,
           coalesce(t.sales,0) as sales, coalesce(t.expenses,0) as expenses,
           case
             when pm.code = v_cash_code and v_start_cash > 0 then v_start_cash
             when pm.code = v_cash_code then v_prev_start_cash + coalesce(y.net,0)
             else coalesce(y.net,0)
           end as starting
      from public.payment_methods pm
      left join yday y on y.c = pm.code
      left join today t on t.c = pm.code
     where pm.owner_only = false
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', b.code, 'label', b.label, 'kind', b.kind::text,
           'starting', round(b.starting, 2),
           'sales', round(b.sales, 2),
           'expenses', round(b.expenses, 2)
         ) order by b.sort_order), '[]'::jsonb)
    into v_rows
    from base b
   where b.is_active or b.sales <> 0 or b.expenses <> 0 or b.starting <> 0;
  return v_rows;
end $$;
grant execute on function public.tc_eos_balances(uuid) to authenticated;

-- Yesterday's closing CASH only (used to auto-fill today's starting cash).
create or replace function public.tc_prev_closing_cash()
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_prev date := (now() at time zone 'Asia/Manila')::date - 1;
  v_cash_code text := public.eos_pm_code(null, 'cash');
  v_start numeric;
  v_net numeric;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select coalesce(sum(starting_cash),0) into v_start from public.shifts where business_date = v_prev;
  select coalesce(sum(coalesce(d.sales,0) - coalesce(d.expenses,0)),0) into v_net
    from public.eos_day_by_method(v_prev) d where d.code = v_cash_code;
  return round(v_start + v_net, 2);
end $$;
grant execute on function public.tc_prev_closing_cash() to authenticated;

notify pgrst, 'reload schema';
