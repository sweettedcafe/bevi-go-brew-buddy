-- =====================================================================
-- BEVI & GO — Phase 11: Admin timeclock + EOS reporting
-- Run AFTER phase 10. Idempotent.
-- =====================================================================

-- List shifts across all baristas in a date range (admin only)
create or replace function public.tc_admin_shifts(
  p_from date default null,
  p_to   date default null,
  p_user_id uuid default null
) returns table (
  shift_id        uuid,
  user_id         uuid,
  user_email      text,
  business_date   date,
  clock_in        timestamptz,
  clock_out       timestamptz,
  starting_cash   numeric,
  break_seconds   bigint,
  worked_seconds  bigint,
  leave_hours     numeric,
  net_worked_hours numeric,
  total_expenses  numeric
)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
    then raise exception 'not authorized'; end if;

  return query
  with br as (
    select sb.shift_id as sid,
      coalesce(sum(extract(epoch from (coalesce(sb.ended_at, now()) - sb.started_at))),0)::bigint as secs
      from public.shift_breaks sb group by sb.shift_id
  ),
  ex as (
    select se.shift_id as sid, coalesce(sum(se.amount),0)::numeric as tot
      from public.shift_expenses se group by se.shift_id
  ),
  lv as (
    select lr.user_id as uid, lr.leave_date as ldate,
      sum(case when lr.duration = 'full' then 8 else 4 end)::numeric as hrs
      from public.leave_requests lr where lr.status = 'approved'
      group by lr.user_id, lr.leave_date
  )
  select
    s.id,
    s.user_id,
    u.email::text,
    s.business_date,
    s.clock_in,
    s.clock_out,
    s.starting_cash,
    coalesce(br.secs, 0),
    (extract(epoch from (coalesce(s.clock_out, now()) - s.clock_in))::bigint - coalesce(br.secs,0)),
    coalesce(lv.hrs, 0),
    round(
      ((extract(epoch from (coalesce(s.clock_out, now()) - s.clock_in))::numeric - coalesce(br.secs,0)) / 3600.0)
      - coalesce(lv.hrs, 0)
    , 2),
    coalesce(ex.tot, 0)
  from public.shifts s
  left join auth.users u on u.id = s.user_id
  left join br on br.sid = s.id
  left join ex on ex.sid = s.id
  left join lv on lv.uid = s.user_id and lv.ldate = s.business_date
  where (p_from    is null or s.business_date >= p_from)
    and (p_to      is null or s.business_date <= p_to)
    and (p_user_id is null or s.user_id = p_user_id)
  order by s.business_date desc, s.clock_in desc;
end $$;

grant execute on function public.tc_admin_shifts(date,date,uuid) to authenticated;

-- List leaves across staff (admin) with optional status filter
create or replace function public.tc_admin_leaves(
  p_status public.leave_status default null
) returns table (
  id uuid, user_id uuid, user_email text, leave_date date,
  duration public.leave_duration, reason text, status public.leave_status,
  reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
    then raise exception 'not authorized'; end if;
  return query
    select lr.id, lr.user_id, u.email::text, lr.leave_date, lr.duration,
           lr.reason, lr.status, lr.reviewed_by, lr.reviewed_at, lr.created_at
      from public.leave_requests lr
      left join auth.users u on u.id = lr.user_id
     where (p_status is null or lr.status = p_status)
     order by lr.created_at desc;
end $$;
grant execute on function public.tc_admin_leaves(public.leave_status) to authenticated;
