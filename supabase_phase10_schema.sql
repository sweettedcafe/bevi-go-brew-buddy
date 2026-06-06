-- =====================================================================
-- BEVI & GO — Phase 10: Timeclock, Leaves, Shift Expenses, EOS Report
-- Run AFTER phases 1–9. Idempotent. All timestamps stored UTC; presentation
-- in Asia/Manila is done by the helpers below.
-- =====================================================================

-- ---------- 0. Enums ---------------------------------------------------
do $$ begin
  create type public.break_type as enum ('break','lunch');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.leave_duration as enum ('full','half');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.leave_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

-- ---------- 1. Tables --------------------------------------------------
create table if not exists public.shifts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  business_date   date not null,
  clock_in        timestamptz not null default now(),
  clock_out       timestamptz,
  starting_cash   numeric(10,2) not null default 0,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists shifts_user_open_idx
  on public.shifts(user_id) where clock_out is null;
create index if not exists shifts_business_date_idx
  on public.shifts(business_date desc);

create table if not exists public.shift_breaks (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references public.shifts(id) on delete cascade,
  type        public.break_type not null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists shift_breaks_shift_idx on public.shift_breaks(shift_id);

create table if not exists public.shift_expenses (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.shifts(id) on delete cascade,
  description  text not null,
  amount       numeric(10,2) not null check (amount >= 0),
  category     text,
  created_at   timestamptz not null default now()
);
create index if not exists shift_expenses_shift_idx on public.shift_expenses(shift_id);

create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  leave_date    date not null,
  duration      public.leave_duration not null,
  reason        text,
  status        public.leave_status not null default 'pending',
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists leave_requests_user_idx on public.leave_requests(user_id);
create index if not exists leave_requests_status_idx on public.leave_requests(status);

-- ---------- 2. Grants & RLS -------------------------------------------
grant select, insert, update, delete on public.shifts          to authenticated;
grant select, insert, update, delete on public.shift_breaks    to authenticated;
grant select, insert, update, delete on public.shift_expenses  to authenticated;
grant select, insert, update, delete on public.leave_requests  to authenticated;
grant all on public.shifts, public.shift_breaks, public.shift_expenses,
            public.leave_requests to service_role;

alter table public.shifts          enable row level security;
alter table public.shift_breaks    enable row level security;
alter table public.shift_expenses  enable row level security;
alter table public.leave_requests  enable row level security;

-- Drop & recreate to stay idempotent
drop policy if exists "shifts self rw"   on public.shifts;
drop policy if exists "shifts admin rw"  on public.shifts;
drop policy if exists "breaks self rw"   on public.shift_breaks;
drop policy if exists "breaks admin rw"  on public.shift_breaks;
drop policy if exists "exp self rw"      on public.shift_expenses;
drop policy if exists "exp admin rw"     on public.shift_expenses;
drop policy if exists "leave self rw"    on public.leave_requests;
drop policy if exists "leave admin rw"   on public.leave_requests;

create policy "shifts self rw" on public.shifts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "shifts admin rw" on public.shifts
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

create policy "breaks self rw" on public.shift_breaks
  for all to authenticated
  using (exists(select 1 from public.shifts s where s.id = shift_id and s.user_id = auth.uid()))
  with check (exists(select 1 from public.shifts s where s.id = shift_id and s.user_id = auth.uid()));
create policy "breaks admin rw" on public.shift_breaks
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

create policy "exp self rw" on public.shift_expenses
  for all to authenticated
  using (exists(select 1 from public.shifts s where s.id = shift_id and s.user_id = auth.uid()))
  with check (exists(select 1 from public.shifts s where s.id = shift_id and s.user_id = auth.uid()));
create policy "exp admin rw" on public.shift_expenses
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

create policy "leave self rw" on public.leave_requests
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "leave admin rw" on public.leave_requests
  for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

-- ---------- 3. Helpers -------------------------------------------------
-- Manila "today" (business date) for a given timestamptz
create or replace function public.tc_manila_date(p_ts timestamptz default now())
returns date language sql immutable as $$
  select (p_ts at time zone 'Asia/Manila')::date
$$;

-- ---------- 4. RPCs ----------------------------------------------------
-- Clock in: starts a new shift if user has no open one
create or replace function public.tc_clock_in(p_starting_cash numeric default 0)
returns public.shifts
language plpgsql security definer set search_path = public as $$
declare v_open public.shifts; v_new public.shifts;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_open from public.shifts
   where user_id = auth.uid() and clock_out is null limit 1;
  if v_open.id is not null then return v_open; end if;

  insert into public.shifts(user_id, business_date, starting_cash)
  values (auth.uid(), public.tc_manila_date(now()), coalesce(p_starting_cash,0))
  returning * into v_new;
  return v_new;
end $$;

create or replace function public.tc_clock_out()
returns public.shifts
language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_shift from public.shifts
   where user_id = auth.uid() and clock_out is null
   order by clock_in desc limit 1;
  if v_shift.id is null then raise exception 'no open shift'; end if;

  -- close any open break too
  update public.shift_breaks set ended_at = now()
   where shift_id = v_shift.id and ended_at is null;

  update public.shifts set clock_out = now()
    where id = v_shift.id returning * into v_shift;
  return v_shift;
end $$;

create or replace function public.tc_break_start(p_type public.break_type)
returns public.shift_breaks
language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_br public.shift_breaks;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_shift from public.shifts
   where user_id = auth.uid() and clock_out is null limit 1;
  if v_shift.id is null then raise exception 'no open shift'; end if;

  select * into v_br from public.shift_breaks
   where shift_id = v_shift.id and ended_at is null limit 1;
  if v_br.id is not null then raise exception 'a break is already in progress'; end if;

  insert into public.shift_breaks(shift_id, type) values (v_shift.id, p_type)
    returning * into v_br;
  return v_br;
end $$;

create or replace function public.tc_break_end()
returns public.shift_breaks
language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_br public.shift_breaks;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_shift from public.shifts
   where user_id = auth.uid() and clock_out is null limit 1;
  if v_shift.id is null then raise exception 'no open shift'; end if;

  update public.shift_breaks set ended_at = now()
   where shift_id = v_shift.id and ended_at is null
   returning * into v_br;
  if v_br.id is null then raise exception 'no break in progress'; end if;
  return v_br;
end $$;

-- Active state for the current user (shift + current break if any)
create or replace function public.tc_active()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_br public.shift_breaks;
begin
  if auth.uid() is null then return jsonb_build_object('shift', null); end if;
  select * into v_shift from public.shifts
   where user_id = auth.uid() and clock_out is null
   order by clock_in desc limit 1;
  if v_shift.id is null then return jsonb_build_object('shift', null); end if;

  select * into v_br from public.shift_breaks
   where shift_id = v_shift.id and ended_at is null limit 1;

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'active_break', case when v_br.id is null then null else to_jsonb(v_br) end
  );
end $$;

-- Expenses
create or replace function public.tc_add_expense(
  p_description text, p_amount numeric, p_category text default null
) returns public.shift_expenses
language plpgsql security definer set search_path = public as $$
declare v_shift public.shifts; v_exp public.shift_expenses;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_description),'') = '' then raise exception 'description required'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'amount must be >= 0'; end if;

  select * into v_shift from public.shifts
   where user_id = auth.uid() and clock_out is null
   order by clock_in desc limit 1;
  if v_shift.id is null then raise exception 'no open shift'; end if;

  insert into public.shift_expenses(shift_id, description, amount, category)
  values (v_shift.id, trim(p_description), p_amount, nullif(trim(p_category),''))
  returning * into v_exp;
  return v_exp;
end $$;

create or replace function public.tc_delete_expense(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.shift_expenses
   where id = p_id
     and exists(select 1 from public.shifts s
                where s.id = shift_id and s.user_id = auth.uid()
                  and s.clock_out is null);
end $$;

-- Leaves
create or replace function public.tc_file_leave(
  p_date date, p_duration public.leave_duration, p_reason text default null
) returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare v_lr public.leave_requests;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_date is null then raise exception 'leave date required'; end if;

  insert into public.leave_requests(user_id, leave_date, duration, reason)
  values (auth.uid(), p_date, p_duration, nullif(trim(p_reason),''))
  returning * into v_lr;
  return v_lr;
end $$;

create or replace function public.tc_my_leaves()
returns setof public.leave_requests
language sql security definer set search_path = public as $$
  select * from public.leave_requests
   where user_id = auth.uid()
   order by leave_date desc, created_at desc
$$;

create or replace function public.tc_review_leave(p_id uuid, p_status public.leave_status)
returns public.leave_requests
language plpgsql security definer set search_path = public as $$
declare v_lr public.leave_requests;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
    then raise exception 'not authorized'; end if;
  update public.leave_requests
     set status = p_status, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id
   returning * into v_lr;
  return v_lr;
end $$;

-- End-of-shift report: shift details + payment net for the Manila business
-- date + expenses + approved leave deduction
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

  -- Payments per method for the shift's business_date (all cashiers)
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
       and o.status in ('completed','refunded')
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

-- Grants on RPCs
grant execute on function public.tc_clock_in(numeric)              to authenticated;
grant execute on function public.tc_clock_out()                    to authenticated;
grant execute on function public.tc_break_start(public.break_type) to authenticated;
grant execute on function public.tc_break_end()                    to authenticated;
grant execute on function public.tc_active()                       to authenticated;
grant execute on function public.tc_add_expense(text,numeric,text) to authenticated;
grant execute on function public.tc_delete_expense(uuid)           to authenticated;
grant execute on function public.tc_file_leave(date,public.leave_duration,text) to authenticated;
grant execute on function public.tc_my_leaves()                    to authenticated;
grant execute on function public.tc_review_leave(uuid,public.leave_status) to authenticated;
grant execute on function public.tc_eos_report(uuid)               to authenticated;
