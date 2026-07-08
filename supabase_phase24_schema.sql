-- =====================================================================
-- BEVI & GO — Phase 24
--   1) customer_by_token: no longer require is_active, only reject soft-deleted
--   2) shift_expenses: add invoice_number, receipt_url columns
--   3) tc_add_expense_v3 accepts invoice_number + receipt_url
--   4) admin_list_expenses(from,to) returns expenses joined with cashier email
--   5) dev_delete_expense(uuid) — developer-only deletion
-- Idempotent; run after phase 23.
-- =====================================================================

-- ---------- 1. customer_by_token — tolerate is_active=false --------
create or replace function public.customer_by_token(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_c public.customers%rowtype;
begin
  select * into v_c from public.customers
   where token = p_token
     and (deleted_at is null);
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_c.id, 'code', v_c.code, 'name', v_c.name,
    'phone', v_c.phone, 'points', v_c.points
  );
end $$;
grant execute on function public.customer_by_token(text) to anon, authenticated;

-- ---------- 2. shift_expenses: invoice_number + receipt_url --------
alter table public.shift_expenses
  add column if not exists invoice_number text,
  add column if not exists receipt_url text;

create index if not exists shift_expenses_invoice_idx
  on public.shift_expenses (invoice_number);

-- ---------- 3. tc_add_expense_v3 -----------------------------------
create or replace function public.tc_add_expense_v3(
  p_description text,
  p_quantity numeric,
  p_unit_price numeric,
  p_category text default null,
  p_invoice_number text default null,
  p_receipt_url text default null
) returns public.shift_expenses
language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_exp public.shift_expenses;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_description),'') = '' then raise exception 'description required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be > 0'; end if;
  if p_unit_price is null or p_unit_price < 0 then raise exception 'unit price must be >= 0'; end if;

  select * into v_shift from public.shifts
   where user_id = auth.uid() and clock_out is null
   order by clock_in desc limit 1;
  if v_shift.id is null then raise exception 'no open shift'; end if;

  insert into public.shift_expenses(
    shift_id, description, quantity, unit_price, amount, category,
    invoice_number, receipt_url
  )
  values (
    v_shift.id, trim(p_description), p_quantity, p_unit_price,
    round(p_quantity * p_unit_price, 2), nullif(trim(p_category),''),
    nullif(trim(p_invoice_number),''), nullif(trim(p_receipt_url),'')
  )
  returning * into v_exp;
  return v_exp;
end $$;
grant execute on function public.tc_add_expense_v3(text, numeric, numeric, text, text, text) to authenticated;

-- ---------- 4. admin_list_expenses ---------------------------------
-- Staff-only listing across all shifts with cashier email.
create or replace function public.admin_list_expenses(p_from timestamptz, p_to timestamptz)
returns table(
  id uuid,
  shift_id uuid,
  description text,
  category text,
  quantity numeric,
  unit_price numeric,
  amount numeric,
  invoice_number text,
  receipt_url text,
  created_at timestamptz,
  cashier_user_id uuid,
  cashier_email text
)
language sql security definer set search_path = public, auth as $$
  select e.id, e.shift_id, e.description, e.category, e.quantity, e.unit_price,
         e.amount, e.invoice_number, e.receipt_url, e.created_at,
         s.user_id, u.email::text
    from public.shift_expenses e
    join public.shifts s on s.id = e.shift_id
    left join auth.users u on u.id = s.user_id
   where public.is_staff(auth.uid())
     and e.created_at >= p_from
     and e.created_at <= p_to
   order by e.created_at desc
$$;
grant execute on function public.admin_list_expenses(timestamptz, timestamptz) to authenticated;

-- ---------- 5. dev_delete_expense — developer-only ------------------
create or replace function public.dev_delete_expense(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.has_role(auth.uid(),'developer') then
    raise exception 'developer only';
  end if;
  delete from public.shift_expenses where id = p_id;
end $$;
grant execute on function public.dev_delete_expense(uuid) to authenticated;

notify pgrst, 'reload schema';
