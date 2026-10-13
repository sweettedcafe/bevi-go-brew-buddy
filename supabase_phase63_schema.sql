-- Phase 63: Inventory Historical Report — show the phase-62 "size correction" stock
-- deductions on the day of the original sale (not at the moment the fix was run),
-- tag them as Automatic entry, and pair audit rows with stock movements one-to-one.
-- Read-only change: only the report function is replaced; no stock or history is modified.

create or replace function public.inventory_history(p_from timestamptz, p_to timestamptz)
returns table(
  id text,
  created_at timestamptz,
  inventory_item_id uuid,
  item_name text,
  unit text,
  delta numeric,
  reason text,
  ref_table text,
  ref_id text,
  actor_id uuid,
  user_name text,
  user_email text,
  entry_type text
)
language sql stable security definer
set search_path = public, auth
set statement_timeout = '120s'
as $$
  with gate as (
    select public.is_staff(auth.uid()) as ok
  ),
  first_audit as (
    select min(a.created_at) as ts
      from public.admin_audit_logs a
     where a.target_table = 'inventory_items'
  ),
  -- moments when the one-time size fix ran; those rows are re-dated to the sale
  backfill_ts as (
    select distinct m.created_at as ts
      from public.inventory_movements m
     where m.ref_table = 'variant_backfill'
  ),
  audit_rows as (
    select a.id, a.created_at,
           case when a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then a.target_id::uuid end as item_uuid,
           a.actor_id, a.actor_email, a.action,
           coalesce(a.after_data, a.before_data) as snap,
           case
             when a.action = 'inventory_items.create' then coalesce((a.after_data->>'stock_qty')::numeric, 0)
             when a.action = 'inventory_items.delete' then -coalesce((a.before_data->>'stock_qty')::numeric, 0)
             else coalesce((a.after_data->>'stock_qty')::numeric, 0)
                - coalesce((a.before_data->>'stock_qty')::numeric, 0)
           end as delta
      from public.admin_audit_logs a
     where (select g.ok from gate g)
       and a.target_table = 'inventory_items'
       and ((a.created_at >= p_from and a.created_at <= p_to)
            or a.created_at in (select ts from backfill_ts))
  ),
  changed as (
    select r.*,
           row_number() over (partition by r.item_uuid, r.created_at, round(r.delta, 3) order by r.id) as rn
      from audit_rows r
     where r.delta <> 0
  ),
  mv_window as (
    select m.id, m.inventory_item_id, m.delta, m.created_at, m.reason, m.ref_table, m.ref_id,
           row_number() over (partition by m.inventory_item_id, m.created_at, round(m.delta, 3) order by m.id) as rn
      from public.inventory_movements m
     where (m.created_at >= p_from - interval '5 seconds' and m.created_at <= p_to + interval '5 seconds')
        or m.created_at in (select ts from backfill_ts)
  ),
  -- 1) exact pairing: same item, same instant, same amount, same position
  exact as (
    select c.id as audit_id, mv.id as mv_id, mv.reason, mv.ref_table, mv.ref_id
      from changed c
      join mv_window mv
        on mv.inventory_item_id = c.item_uuid
       and mv.created_at = c.created_at
       and round(mv.delta, 3) = round(c.delta, 3)
       and mv.rn = c.rn
  ),
  -- 2) nearest-in-time pairing for anything left over
  fuzzy as (
    select distinct on (c.id)
           c.id as audit_id, mv.id as mv_id, mv.reason, mv.ref_table, mv.ref_id
      from changed c
      join mv_window mv
        on mv.inventory_item_id = c.item_uuid
       and mv.created_at between c.created_at - interval '5 seconds' and c.created_at + interval '5 seconds'
       and abs(mv.delta - c.delta) < 0.0005
     where not exists (select 1 from exact e where e.audit_id = c.id)
     order by c.id, abs(extract(epoch from (mv.created_at - c.created_at)))
  ),
  matched as (
    select * from exact
    union all
    select * from fuzzy
  ),
  from_audit as (
    select 'a' || r.id::text as id,
           case when mt.ref_table = 'variant_backfill' then coalesce(o.created_at, r.created_at)
                else r.created_at end as created_at,
           r.item_uuid as inventory_item_id,
           coalesce(i.name, r.snap->>'name') as item_name,
           coalesce(i.unit, r.snap->>'unit') as unit,
           r.delta,
           case when mt.ref_table = 'variant_backfill' then 'order (size added later)'
                else coalesce(mt.reason,
                    case r.action when 'inventory_items.create' then 'new item'
                                  when 'inventory_items.delete' then 'item deleted'
                                  else 'manual adjustment' end) end as reason,
           case when mt.ref_table = 'variant_backfill' then 'orders' else mt.ref_table end as ref_table,
           case when mt.ref_table = 'variant_backfill' then oi.order_id::text else mt.ref_id end as ref_id,
           case when mt.ref_table = 'variant_backfill' then o.cashier_id else r.actor_id end as actor_id,
           nullif(p.full_name, '') as user_name,
           coalesce(case when mt.ref_table = 'variant_backfill' then u.email::text end,
                    r.actor_email, u.email::text) as user_email,
           case when mt.mv_id is not null
                 and (coalesce(mt.ref_table,'') in ('orders','order_items','refunds','voids','variant_backfill')
                      or mt.reason in ('order','refund','void','sale'))
                then 'Automatic entry' else 'Manual entry' end as entry_type
      from changed r
      left join matched mt on mt.audit_id = r.id
      left join public.order_items oi
        on mt.ref_table = 'variant_backfill'
       and mt.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and oi.id = mt.ref_id::uuid
      left join public.orders o on o.id = oi.order_id
      left join public.inventory_items i on i.id = r.item_uuid
      left join auth.users u
        on u.id = case when mt.ref_table = 'variant_backfill' then o.cashier_id else r.actor_id end
      left join public.profiles p
        on p.id = case when mt.ref_table = 'variant_backfill' then o.cashier_id else r.actor_id end
  ),
  from_legacy as (
    select 'm' || m.id::text as id, m.created_at, m.inventory_item_id,
           i.name as item_name, i.unit, m.delta, m.reason, m.ref_table, m.ref_id, m.actor_id,
           nullif(p.full_name, '') as user_name, u.email::text as user_email,
           case when coalesce(m.ref_table,'') in ('orders','order_items','refunds','voids')
                  or m.reason in ('order','refund','void','sale')
                then 'Automatic entry' else 'Manual entry' end as entry_type
      from public.inventory_movements m
      left join public.inventory_items i on i.id = m.inventory_item_id
      left join auth.users u on u.id = m.actor_id
      left join public.profiles p on p.id = m.actor_id
     where (select g.ok from gate g)
       and m.created_at >= p_from and m.created_at <= p_to
       and m.created_at < coalesce((select ts from first_audit), 'infinity'::timestamptz)
  )
  select * from (
    select * from from_audit
    union all
    select * from from_legacy
  ) x
  where x.created_at >= p_from and x.created_at <= p_to
  order by x.created_at desc, x.id desc
$$;

grant execute on function public.inventory_history(timestamptz, timestamptz) to authenticated;
notify pgrst, 'reload schema';
