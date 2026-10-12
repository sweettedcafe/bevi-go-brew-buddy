-- Phase 58 (v2): Starting Balance = yesterday's EOD balance, broken down per payment method.
-- EOD(method, day) = Starting(method, day) + Sales(method, day) - Expenses(method, day)
-- Starting(method, day) = EOD(method, previous business day)
--   (cash only: a starting cash entered for that day overrides the carry-over)
-- v2: no temp tables, no ambiguous column names (v1 failed and returned nothing).

drop function if exists public.eos_eod_by_method(date);
create or replace function public.eos_eod_by_method(p_date date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cash text := public.eos_pm_code(null, 'cash');
  v_day date;
  v_start_cash numeric;
  v_map jsonb := '{}'::jsonb;
  r record;
begin
  for v_day in
    select distinct s.business_date from public.shifts s where s.business_date <= p_date order by 1
  loop
    select coalesce(sum(s.starting_cash),0) into v_start_cash from public.shifts s where s.business_date = v_day;
    if v_start_cash > 0 then
      v_map := v_map || jsonb_build_object(v_cash, v_start_cash);
    end if;
    for r in select d.code as c, coalesce(d.sales,0) - coalesce(d.expenses,0) as n
               from public.eos_day_by_method(v_day) d loop
      if r.c is not null then
        v_map := v_map || jsonb_build_object(r.c, coalesce((v_map->>r.c)::numeric,0) + r.n);
      end if;
    end loop;
  end loop;
  return v_map;
end $$;

create or replace function public.tc_eos_balances(p_shift_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_date date; v_prev date; v_cash_code text; v_start_cash numeric;
        v_prior jsonb := '{}'::jsonb; v_rows jsonb;
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
  v_cash_code := public.eos_pm_code(null, 'cash');
  select coalesce(sum(starting_cash),0) into v_start_cash from public.shifts where business_date = v_date;
  select max(business_date) into v_prev from public.shifts where business_date < v_date;
  if v_prev is not null then v_prior := public.eos_eod_by_method(v_prev); end if;

  with today as (select d.code, d.sales, d.expenses from public.eos_day_by_method(v_date) d)
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', pm.code, 'label', pm.label, 'kind', pm.kind::text,
           'starting', round(case when pm.code = v_cash_code and v_start_cash > 0
                                  then v_start_cash
                                  else coalesce((v_prior->>pm.code)::numeric,0) end, 2),
           'sales', round(coalesce(t.sales,0), 2),
           'expenses', round(coalesce(t.expenses,0), 2)
         ) order by pm.sort_order), '[]'::jsonb)
    into v_rows
    from public.payment_methods pm
    left join today t on t.code = pm.code
   where pm.owner_only = false
     and (pm.is_active or coalesce(t.sales,0) <> 0 or coalesce(t.expenses,0) <> 0
          or coalesce((v_prior->>pm.code)::numeric,0) <> 0);
  return v_rows;
end $$;
grant execute on function public.tc_eos_balances(uuid) to authenticated;

-- Yesterday's closing CASH only (used to auto-fill today's starting cash).
create or replace function public.tc_prev_closing_cash()
returns numeric language plpgsql security definer set search_path=public as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date; v_prev date;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select max(business_date) into v_prev from public.shifts where business_date < v_today;
  if v_prev is null then return 0; end if;
  return round(coalesce((public.eos_eod_by_method(v_prev)->>public.eos_pm_code(null,'cash'))::numeric, 0), 2);
end $$;
grant execute on function public.tc_prev_closing_cash() to authenticated;

notify pgrst, 'reload schema';
