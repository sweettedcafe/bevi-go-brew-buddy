-- Phase 65
-- 1) Allow negative expense amounts (corrections / deposits). The original
--    table had CHECK (amount >= 0), which blocked negative entries.
-- 2) Starting Balance = yesterday's EOD Balance per payment method
--    (EOD = Starting + Sales - Expenses), carried day to day from Oct 12, 2026.
--    Cash still uses the day's declared starting cash when it is set.

alter table public.shift_expenses drop constraint if exists shift_expenses_amount_check;

create or replace function public.eos_start_by_method(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_anchor date := date '2026-10-12';
  v_cash text := public.eos_pm_code(null, 'cash');
  v_d date;
  v_start jsonb := '{}'::jsonb;
  v_eod jsonb := '{}'::jsonb;
  v_sc numeric;
  r record;
begin
  v_d := least(p_date, v_anchor);
  -- Base day: previous day's net per method; cash = declared or prior cash closing.
  for r in select code from public.payment_methods loop
    v_start := v_start || jsonb_build_object(r.code,
      coalesce((select coalesce(sales,0) - coalesce(expenses,0)
                  from public.eos_day_by_method(v_d - 1) where code = r.code), 0));
  end loop;
  select coalesce(sum(starting_cash),0) into v_sc from public.shifts where business_date = v_d;
  if v_sc > 0 then
    v_start := v_start || jsonb_build_object(v_cash, v_sc);
  else
    select coalesce(sum(starting_cash),0) into v_sc from public.shifts where business_date = v_d - 1;
    v_start := v_start || jsonb_build_object(v_cash, v_sc + coalesce((v_start->>v_cash)::numeric,0));
  end if;

  while v_d < p_date loop
    -- EOD of v_d
    v_eod := '{}'::jsonb;
    for r in select pm.code,
                    coalesce(d.sales,0) - coalesce(d.expenses,0) as net
               from public.payment_methods pm
               left join public.eos_day_by_method(v_d) d on d.code = pm.code loop
      v_eod := v_eod || jsonb_build_object(r.code, coalesce((v_start->>r.code)::numeric,0) + r.net);
    end loop;
    v_d := v_d + 1;
    v_start := v_eod;
    select coalesce(sum(starting_cash),0) into v_sc from public.shifts where business_date = v_d;
    if v_sc > 0 then v_start := v_start || jsonb_build_object(v_cash, v_sc); end if;
  end loop;
  return v_start;
end $$;

create or replace function public.eos_balances_for_date(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_start jsonb := public.eos_start_by_method(p_date); v_rows jsonb;
begin
  with today as (select d.code as c, d.sales, d.expenses from public.eos_day_by_method(p_date) d),
  base as (
    select pm.code, pm.label, pm.kind, pm.sort_order, pm.is_active,
           coalesce(t.sales,0) as sales, coalesce(t.expenses,0) as expenses,
           coalesce((v_start->>pm.code)::numeric,0) as starting
      from public.payment_methods pm
      left join today t on t.c = pm.code
     where pm.owner_only = false
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', b.code, 'label', b.label, 'kind', b.kind::text,
           'starting', round(b.starting, 2), 'sales', round(b.sales, 2),
           'expenses', round(b.expenses, 2)) order by b.sort_order), '[]'::jsonb)
    into v_rows from base b
   where b.is_active or b.sales <> 0 or b.expenses <> 0 or b.starting <> 0;
  return v_rows;
end $$;

create or replace function public.tc_eos_balances(p_shift_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts;
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
  return public.eos_balances_for_date(v_shift.business_date);
end $$;
grant execute on function public.tc_eos_balances(uuid) to authenticated;

create or replace function public.tc_eos_day_report(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_shifts jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_date is null then raise exception 'pick a date first'; end if;
  if not exists (select 1 from public.shifts where business_date = p_date and user_id = auth.uid())
     and not exists (select 1 from public.user_roles where user_id = auth.uid()
                        and role::text in ('admin','developer','partner','accountant'))
    then raise exception 'You can only view summaries for days you worked.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_email', u.email, 'clock_in', s.clock_in, 'clock_out', s.clock_out
         ) order by s.clock_in), '[]'::jsonb)
    into v_shifts
    from public.shifts s left join auth.users u on u.id = s.user_id
   where s.business_date = p_date;
  return jsonb_build_object('business_date', p_date, 'shifts', v_shifts,
                            'balances', public.eos_balances_for_date(p_date));
end $$;
grant execute on function public.tc_eos_day_report(date) to authenticated;

-- Yesterday's closing CASH (auto-fills today's starting cash).
create or replace function public.tc_prev_closing_cash()
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_prev date := (now() at time zone 'Asia/Manila')::date - 1;
  v_cash text := public.eos_pm_code(null, 'cash');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return round(coalesce((public.eos_start_by_method(v_prev)->>v_cash)::numeric,0)
    + coalesce((select coalesce(sales,0) - coalesce(expenses,0)
                  from public.eos_day_by_method(v_prev) where code = v_cash),0), 2);
end $$;
grant execute on function public.tc_prev_closing_cash() to authenticated;

notify pgrst, 'reload schema';
