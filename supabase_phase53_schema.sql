-- =====================================================================
-- BEVI & GO — Phase 53
-- 1. New role: partner
-- 2. Payment methods: "owner only" flag (bank accounts hidden from baristas
--    and from the End of Shift report)
-- 3. Expenses: payment method + reason, negative entries allowed (corrections)
-- 4. Access control: defaults can be switched OFF (allowed = false rows)
-- 5. End of Shift report: per-payment-method Starting / Sales / Expenses /
--    Net / EOD balance, based on the methods set up in Settings
-- NOTE: run the whole file. 'partner' is added first and not used literally
--       elsewhere in this script, so it is safe in one transaction.
-- =====================================================================

-- ---------- 1. partner role -------------------------------------------
alter type public.app_role add value if not exists 'partner';

-- ---------- 2. owner-only payment methods ------------------------------
alter table public.payment_methods
  add column if not exists owner_only boolean not null default false;

drop policy if exists "pm staff read" on public.payment_methods;
create policy "pm staff read" on public.payment_methods
  for select to authenticated using (
    public.is_staff(auth.uid())
    and (not owner_only
         or public.has_role(auth.uid(),'admin')
         or public.has_role(auth.uid(),'developer'))
  );

-- ---------- 3. expenses: method + reason, negatives allowed -----------
alter table public.shift_expenses
  add column if not exists payment_method_code text,
  add column if not exists reason text;

create or replace function public.tc_add_expense_v4(
  p_description text,
  p_quantity numeric,
  p_unit_price numeric,
  p_category text default null,
  p_invoice_number text default null,
  p_receipt_url text default null,
  p_payment_method_code text default null,
  p_reason text default null
) returns public.shift_expenses
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts; v_exp public.shift_expenses; v_pm public.payment_methods;
  v_is_admin boolean := public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer');
  v_amount numeric;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_description),'') = '' then raise exception 'description required'; end if;
  if p_quantity is null or p_quantity = 0 then raise exception 'quantity cannot be 0'; end if;
  if p_unit_price is null then raise exception 'unit price required'; end if;
  v_amount := round(p_quantity * p_unit_price, 2);
  if v_amount < 0 and coalesce(trim(p_reason),'') = '' then
    raise exception 'reason is required for a negative (correction) entry';
  end if;

  if coalesce(p_payment_method_code,'') <> '' then
    select * into v_pm from public.payment_methods where code = p_payment_method_code;
    if not found then raise exception 'invalid payment method'; end if;
    if v_pm.owner_only and not v_is_admin then raise exception 'not allowed to use this payment method'; end if;
    if not v_is_admin and v_pm.kind::text not in ('cash','transfer') then
      raise exception 'baristas can only use cash or e-wallet for expenses';
    end if;
  end if;

  select * into v_shift from public.shifts
   where user_id = auth.uid() and clock_out is null
   order by clock_in desc limit 1;
  if v_shift.id is null then raise exception 'no open shift'; end if;

  insert into public.shift_expenses(
    shift_id, description, quantity, unit_price, amount, category,
    invoice_number, receipt_url, payment_method_code, reason
  ) values (
    v_shift.id, trim(p_description), p_quantity, p_unit_price, v_amount,
    nullif(trim(p_category),''), nullif(trim(p_invoice_number),''),
    nullif(trim(p_receipt_url),''), nullif(p_payment_method_code,''),
    nullif(trim(p_reason),'')
  ) returning * into v_exp;
  return v_exp;
end $$;
grant execute on function public.tc_add_expense_v4(text, numeric, numeric, text, text, text, text, text) to authenticated;

-- ---------- 4. access control: allow revoking defaults ----------------
alter table public.role_access_grants
  add column if not exists allowed boolean not null default true;
grant update on public.role_access_grants to authenticated;
drop policy if exists "grants update admin" on public.role_access_grants;
create policy "grants update admin" on public.role_access_grants
  for update to authenticated
  using ((public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')) and role <> 'developer')
  with check ((public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer')) and role <> 'developer');

-- ---------- 5. EOS per payment method ---------------------------------
-- Resolve the Settings payment-method code for a payment row.
create or replace function public.eos_pm_code(p_code text, p_kind text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select code from public.payment_methods where code = p_code),
    (select code from public.payment_methods where kind::text = p_kind order by sort_order limit 1),
    p_kind)
$$;

-- Net (sales - expenses) per method for one business date.
create or replace function public.eos_day_by_method(p_date date)
returns table(code text, sales numeric, expenses numeric)
language sql stable security definer set search_path = public as $$
  with s as (
    select public.eos_pm_code(op.method_code, op.method::text) as code,
           sum(op.amount - coalesce(op.change_due,0)) as amt
      from public.order_payments op join public.orders o on o.id = op.order_id
     where o.business_date = p_date and o.status::text in ('completed','refunded','voided')
     group by 1
  ), e as (
    select coalesce(e.payment_method_code, public.eos_pm_code(null,'cash')) as code,
           sum(e.amount) as amt
      from public.shift_expenses e join public.shifts sh on sh.id = e.shift_id
     where sh.business_date = p_date
     group by 1
  )
  select coalesce(s.code, e.code), coalesce(s.amt,0), coalesce(e.amt,0)
    from s full join e on e.code = s.code
$$;

create or replace function public.tc_eos_balances(p_shift_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_date date; v_cash_code text; v_start_cash numeric; v_rows jsonb;
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

  with prior as (
    select d.code, sum(d.sales - d.expenses) as net
      from (select distinct business_date from public.shifts where business_date < v_date) bd
      cross join lateral public.eos_day_by_method(bd.business_date) d
     group by d.code
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
