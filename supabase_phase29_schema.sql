-- =====================================================================
-- BEVI & GO — Phase 29: Upsell tracking + Expenses vs Sales analytics
--   1) upsell_events table
--   2) log_upsell_event(source, suggestions_count, added_count)
--   3) analytics_upsell(p_from, p_to) — overall + per barista
--   4) analytics_expenses_vs_sales(p_from, p_to) — daily
--   5) shift_upsell_stats(p_shift_id) — per-shift rate for EOS report
-- Idempotent; run after phase 28.
-- =====================================================================

-- 1) table ------------------------------------------------------------
create table if not exists public.upsell_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('barista','customer')),
  user_id uuid references auth.users(id) on delete set null,
  shift_id uuid references public.shifts(id) on delete set null,
  suggestions_count int not null default 0,
  added_count int not null default 0,
  action text not null check (action in ('added','skipped'))
);

grant select, insert on public.upsell_events to authenticated;
grant insert on public.upsell_events to anon;
grant all on public.upsell_events to service_role;

alter table public.upsell_events enable row level security;

drop policy if exists "upsell insert anyone" on public.upsell_events;
create policy "upsell insert anyone" on public.upsell_events
  for insert to anon, authenticated
  with check (true);

drop policy if exists "upsell staff read" on public.upsell_events;
create policy "upsell staff read" on public.upsell_events
  for select to authenticated
  using (public.is_staff(auth.uid()) or user_id = auth.uid());

create index if not exists upsell_events_created_idx on public.upsell_events(created_at desc);
create index if not exists upsell_events_shift_idx on public.upsell_events(shift_id);
create index if not exists upsell_events_user_idx on public.upsell_events(user_id);

-- 2) log_upsell_event -------------------------------------------------
create or replace function public.log_upsell_event(
  p_source text,
  p_suggestions_count int,
  p_added_count int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shift uuid;
  v_action text;
begin
  if p_source not in ('barista','customer') then
    raise exception 'invalid source';
  end if;
  if p_source = 'barista' and v_uid is not null then
    select id into v_shift from public.shifts
     where user_id = v_uid and clock_out is null
     order by clock_in desc limit 1;
  end if;
  v_action := case when coalesce(p_added_count,0) > 0 then 'added' else 'skipped' end;
  insert into public.upsell_events(source, user_id, shift_id, suggestions_count, added_count, action)
  values (p_source,
          case when p_source = 'barista' then v_uid else null end,
          v_shift,
          coalesce(p_suggestions_count,0),
          coalesce(p_added_count,0),
          v_action);
end $$;
grant execute on function public.log_upsell_event(text, int, int) to anon, authenticated;

-- 3) analytics_upsell -------------------------------------------------
create or replace function public.analytics_upsell(
  p_from date,
  p_to date
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
  v_barista jsonb;
  v_customer jsonb;
  v_per_barista jsonb;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'not authorized';
  end if;
  v_from := (coalesce(p_from, current_date - interval '30 days')::timestamp at time zone 'Asia/Manila');
  v_to := ((coalesce(p_to, current_date) + 1)::timestamp at time zone 'Asia/Manila');

  with base as (
    select * from public.upsell_events
     where created_at >= v_from and created_at < v_to
  ),
  agg as (
    select source,
           count(*)::int as offers,
           count(*) filter (where action = 'added')::int as added,
           count(*) filter (where action = 'skipped')::int as skipped
      from base group by source
  )
  select
    jsonb_build_object(
      'offers', coalesce((select offers from agg where source='barista'),0),
      'added',  coalesce((select added  from agg where source='barista'),0),
      'skipped',coalesce((select skipped from agg where source='barista'),0)
    ),
    jsonb_build_object(
      'offers', coalesce((select offers from agg where source='customer'),0),
      'added',  coalesce((select added  from agg where source='customer'),0),
      'skipped',coalesce((select skipped from agg where source='customer'),0)
    )
  into v_barista, v_customer;

  select coalesce(jsonb_agg(row_to_json(t) order by t.offers desc), '[]'::jsonb)
    into v_per_barista
    from (
      select b.user_id,
             coalesce(u.email::text, '(unknown)') as email,
             count(*)::int as offers,
             count(*) filter (where b.action='added')::int as added,
             count(*) filter (where b.action='skipped')::int as skipped
        from public.upsell_events b
        left join auth.users u on u.id = b.user_id
       where b.created_at >= v_from and b.created_at < v_to
         and b.source = 'barista'
         and b.user_id is not null
       group by b.user_id, u.email
    ) t;

  v_result := jsonb_build_object(
    'from', p_from, 'to', p_to,
    'barista', v_barista,
    'customer', v_customer,
    'per_barista', v_per_barista
  );
  return v_result;
end $$;
grant execute on function public.analytics_upsell(date, date) to authenticated;

-- 4) analytics_expenses_vs_sales --------------------------------------
create or replace function public.analytics_expenses_vs_sales(
  p_from date,
  p_to date
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_from date;
  v_to date;
  v_days jsonb;
  v_totals jsonb;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'not authorized';
  end if;
  v_from := coalesce(p_from, current_date - interval '30 days');
  v_to := coalesce(p_to, current_date);

  with dseries as (
    select generate_series(v_from, v_to, interval '1 day')::date as day
  ),
  sales as (
    select ((paid_at at time zone 'Asia/Manila')::date) as day,
           sum(coalesce(total,0))::numeric as revenue
      from public.orders
     where status = 'paid'
       and paid_at is not null
       and ((paid_at at time zone 'Asia/Manila')::date) between v_from and v_to
     group by 1
  ),
  exp as (
    select ((e.created_at at time zone 'Asia/Manila')::date) as day,
           sum(coalesce(e.amount,0))::numeric as expenses
      from public.shift_expenses e
     where ((e.created_at at time zone 'Asia/Manila')::date) between v_from and v_to
     group by 1
  ),
  joined as (
    select to_char(d.day, 'YYYY-MM-DD') as day,
           coalesce(s.revenue, 0)::numeric as sales,
           coalesce(x.expenses, 0)::numeric as expenses
      from dseries d
      left join sales s on s.day = d.day
      left join exp x on x.day = d.day
     order by d.day
  )
  select jsonb_agg(row_to_json(j)) into v_days from joined j;

  select jsonb_build_object(
    'sales', coalesce(sum(sales),0),
    'expenses', coalesce(sum(expenses),0)
  ) into v_totals
    from jsonb_to_recordset(coalesce(v_days,'[]'::jsonb)) as x(sales numeric, expenses numeric);

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'days', coalesce(v_days, '[]'::jsonb),
    'totals', v_totals
  );
end $$;
grant execute on function public.analytics_expenses_vs_sales(date, date) to authenticated;

-- 5) shift_upsell_stats -----------------------------------------------
create or replace function public.shift_upsell_stats(p_shift_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts;
  v_offers int;
  v_added int;
  v_skipped int;
begin
  if p_shift_id is null then
    -- default to current user's latest shift
    if auth.uid() is null then raise exception 'not authenticated'; end if;
    select * into v_shift from public.shifts
     where user_id = auth.uid()
     order by clock_in desc limit 1;
  else
    select * into v_shift from public.shifts where id = p_shift_id;
  end if;
  if v_shift.id is null then
    return jsonb_build_object('offers',0,'added',0,'skipped',0);
  end if;
  if not (public.is_staff(auth.uid()) or v_shift.user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select
    count(*)::int,
    count(*) filter (where action='added')::int,
    count(*) filter (where action='skipped')::int
    into v_offers, v_added, v_skipped
    from public.upsell_events
   where shift_id = v_shift.id;

  return jsonb_build_object(
    'shift_id', v_shift.id,
    'offers', coalesce(v_offers,0),
    'added', coalesce(v_added,0),
    'skipped', coalesce(v_skipped,0)
  );
end $$;
grant execute on function public.shift_upsell_stats(uuid) to authenticated;

notify pgrst, 'reload schema';
