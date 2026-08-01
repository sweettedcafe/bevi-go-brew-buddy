-- =====================================================================
-- BEVI & GO — Phase 43
-- 1. End of Shift payments include voided/refunded parents so the sale is
--    counted first and the negative mirror subtracts it (no double count).
-- 2. Starting cash is asked only from the FIRST shifter of the business day.
-- 3. Next day's starting cash = starting cash + cash payments − expenses
--    (fixed: it read a non-existent public.payments table).
-- =====================================================================

-- ---------- 1. EOS report: keep voided/refunded parents ---------------
create or replace function public.tc_eos_report(p_shift_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts;
  v_break_seconds bigint := 0;
  v_worked_seconds bigint := 0;
  v_leave_hours numeric := 0;
  v_payments jsonb;
  v_expenses jsonb;
  v_breaks jsonb;
  v_total_expenses numeric := 0;
  v_email text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  if p_shift_id is not null then
    select * into v_shift from public.shifts where id = p_shift_id;
  else
    select * into v_shift from public.shifts
     where user_id = auth.uid()
     order by clock_in desc limit 1;
  end if;
  if v_shift.id is null then raise exception 'no shift found'; end if;
  if v_shift.user_id <> auth.uid()
     and not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
    then raise exception 'not authorized'; end if;

  select coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at))),0)::bigint
    into v_break_seconds
    from public.shift_breaks where shift_id = v_shift.id;

  v_worked_seconds := extract(epoch from (coalesce(v_shift.clock_out, now()) - v_shift.clock_in))::bigint
                      - v_break_seconds;

  select coalesce(sum(case when duration = 'full' then 8 else 4 end), 0)
    into v_leave_hours
    from public.leave_requests
   where user_id = v_shift.user_id
     and leave_date = v_shift.business_date
     and status = 'approved';

  -- Payments per method for the shift's business_date (all cashiers).
  -- Voided/refunded parents stay in: the sale lands in net sales first and
  -- the mirror order's negative payment rows subtract it back out.
  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_payments from (
    select jsonb_build_object(
      'method', op.method::text,
      'gross',  round(sum(op.amount)::numeric, 2),
      'change', round(sum(op.change_due)::numeric, 2),
      'net',    round(sum(op.amount - op.change_due)::numeric, 2),
      'count',  count(*)
    ) as row
      from public.order_payments op
      join public.orders o on o.id = op.order_id
     where o.business_date = v_shift.business_date
       and o.status in ('completed','refunded','voided')
     group by op.method
     order by op.method
  ) t;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb),
         coalesce(sum(e.amount), 0)
    into v_expenses, v_total_expenses
    from public.shift_expenses e where e.shift_id = v_shift.id;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.started_at), '[]'::jsonb)
    into v_breaks
    from public.shift_breaks b where b.shift_id = v_shift.id;

  select email into v_email from auth.users where id = v_shift.user_id;

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'user_email', v_email,
    'break_seconds', v_break_seconds,
    'worked_seconds', v_worked_seconds,
    'leave_hours_deducted', v_leave_hours,
    'net_worked_hours', round((v_worked_seconds::numeric / 3600.0) - v_leave_hours, 2),
    'payments', v_payments,
    'expenses', v_expenses,
    'total_expenses', round(v_total_expenses, 2),
    'breaks', v_breaks
  );
end $$;
grant execute on function public.tc_eos_report(uuid) to authenticated;

-- ---------- 2. Starting cash: first shifter of the day only -----------
create or replace function public.tc_set_starting_cash(p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid(); v_s public.shifts%rowtype; v_other numeric;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'amount must be >= 0'; end if;
  select * into v_s from public.shifts
   where user_id = v_actor and clock_out is null
   order by clock_in desc limit 1;
  if not found then raise exception 'no open shift'; end if;
  if coalesce(v_s.starting_cash, 0) > 0 then
    raise exception 'starting cash already set for this shift';
  end if;

  -- Only the first shifter of the business day declares the drawer.
  select coalesce(sum(starting_cash),0) into v_other
    from public.shifts
   where business_date = v_s.business_date and id <> v_s.id;
  if v_other > 0 then
    raise exception 'starting cash was already declared for today by the first shift';
  end if;

  update public.shifts set starting_cash = p_amount where id = v_s.id;
  return jsonb_build_object('ok', true, 'starting_cash', p_amount);
end $$;
grant execute on function public.tc_set_starting_cash(numeric) to authenticated;

-- Whether the current open shift may declare today's starting cash,
-- plus the amount already declared for the day.
create or replace function public.tc_starting_cash_state()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid(); v_s public.shifts%rowtype; v_other numeric;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  select * into v_s from public.shifts
   where user_id = v_actor
   order by clock_in desc limit 1;
  if not found then
    return jsonb_build_object('can_set', false, 'day_starting_cash', 0);
  end if;
  select coalesce(sum(starting_cash),0) into v_other
    from public.shifts
   where business_date = v_s.business_date and id <> v_s.id;
  return jsonb_build_object(
    'can_set', v_s.clock_out is null
               and coalesce(v_s.starting_cash,0) = 0
               and v_other = 0,
    'day_starting_cash', round(v_other + coalesce(v_s.starting_cash,0), 2)
  );
end $$;
grant execute on function public.tc_starting_cash_state() to authenticated;

-- ---------- 3. Yesterday's closing cash (correct table) ---------------
create or replace function public.tc_prev_closing_cash()
returns numeric language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_prev date;
  v_start numeric := 0; v_cash numeric := 0; v_exp numeric := 0;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  select max(business_date) into v_prev from public.shifts where business_date < v_today;
  if v_prev is null then return 0; end if;

  select coalesce(sum(starting_cash),0) into v_start
    from public.shifts where business_date = v_prev;

  -- Cash taken in, net of change and net of any void/refund mirrors.
  select coalesce(sum(op.amount - coalesce(op.change_due,0)),0) into v_cash
    from public.order_payments op
    join public.orders o on o.id = op.order_id
   where o.business_date = v_prev
     and op.method::text = 'cash'
     and o.status in ('completed','refunded','voided');

  select coalesce(sum(e.amount),0) into v_exp
    from public.shift_expenses e join public.shifts s on s.id = e.shift_id
   where s.business_date = v_prev;

  return round(v_start + v_cash - v_exp, 2);
end $$;
grant execute on function public.tc_prev_closing_cash() to authenticated;

notify pgrst, 'reload schema';
