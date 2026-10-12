-- Phase 60: Shift Summary date filter — look back at any past business date.
-- tc_eos_day_report(p_date) returns that day's baristas/shifts plus the same
-- per-payment-method balances the live shift summary uses:
--   Starting Balance = that method's end-of-day balance yesterday
--                      (cash uses the day's declared starting cash)
--   Sales / Expenses = that day only
-- Needs supabase_phase53_schema.sql (eos_day_by_method) and phase59
-- (tc_eos_balances behaviour) to have been run.

drop function if exists public.tc_eos_day_report(date);

create or replace function public.tc_eos_day_report(p_date date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prev date := p_date - 1;
  v_cash_code text;
  v_start_cash numeric;
  v_prev_start_cash numeric;
  v_rows jsonb;
  v_shifts jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_date is null then raise exception 'pick a date first'; end if;

  -- Baristas may only open a day they actually worked; office roles any day.
  if not exists (select 1 from public.shifts
                  where business_date = p_date and user_id = auth.uid())
     and not exists (select 1 from public.user_roles
                      where user_id = auth.uid()
                        and role::text in ('admin','developer','partner','accountant'))
    then raise exception 'You can only view summaries for days you worked.';
  end if;

  v_cash_code := public.eos_pm_code(null, 'cash');
  select coalesce(sum(starting_cash),0) into v_start_cash
    from public.shifts where business_date = p_date;
  select coalesce(sum(starting_cash),0) into v_prev_start_cash
    from public.shifts where business_date = v_prev;

  with yday as (
    select d.code as c, coalesce(d.sales,0) - coalesce(d.expenses,0) as net
      from public.eos_day_by_method(v_prev) d
  ), today as (
    select d.code as c, d.sales, d.expenses from public.eos_day_by_method(p_date) d
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_email', u.email,
           'clock_in', s.clock_in,
           'clock_out', s.clock_out
         ) order by s.clock_in), '[]'::jsonb)
    into v_shifts
    from public.shifts s
    left join auth.users u on u.id = s.user_id
   where s.business_date = p_date;

  return jsonb_build_object(
    'business_date', p_date,
    'shifts', v_shifts,
    'balances', v_rows
  );
end $$;

grant execute on function public.tc_eos_day_report(date) to authenticated;

notify pgrst, 'reload schema';
