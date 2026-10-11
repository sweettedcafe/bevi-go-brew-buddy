-- Phase 57: End of Shift starting balance = yesterday's EOD balance per payment method.
-- Before: non-cash starting balances summed every prior day ever (e.g. old Visa/Master sales
-- kept showing). Now: only the previous business day counts.
--   Cash      -> today's starting cash (auto-filled from yesterday's closing cash)
--   Others    -> yesterday's sales - yesterday's expenses for that method
create or replace function public.tc_eos_balances(p_shift_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_date date; v_prev date; v_cash_code text; v_start_cash numeric; v_rows jsonb;
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

  with prior as (
    select d.code, (d.sales - d.expenses) as net
      from public.eos_day_by_method(v_prev) d
     where v_prev is not null
  ), today as (select * from public.eos_day_by_method(v_date))
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', pm.code, 'label', pm.label, 'kind', pm.kind::text,
           'starting', round(case when pm.code = v_cash_code then v_start_cash else coalesce(p.net,0) end, 2),
           'sales', round(coalesce(t.sales,0), 2),
           'expenses', round(coalesce(t.expenses,0), 2)
         ) order by pm.sort_order), '[]'::jsonb)
    into v_rows
    from public.payment_methods pm
    left join prior p on p.code = pm.code
    left join today t on t.code = pm.code
   where pm.owner_only = false
     and (pm.is_active or coalesce(t.sales,0) <> 0 or coalesce(t.expenses,0) <> 0);
  return v_rows;
end $$;
grant execute on function public.tc_eos_balances(uuid) to authenticated;

notify pgrst, 'reload schema';
