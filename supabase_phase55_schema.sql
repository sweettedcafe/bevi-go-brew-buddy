-- Phase 55: fix "canceling statement due to statement timeout" in Inventory Historical Report.
-- Cause: phase 54 matched every audit row to POS stock movements with a per-row lookup that
-- compared uuid::text (no index could be used) and the staff check ran per row.
-- Fix: add indexes, match movements with ONE hash join on typed uuid, check staff once,
-- and give the function a longer time budget.

create index if not exists admin_audit_logs_target_created_idx
  on public.admin_audit_logs (target_table, created_at);
create index if not exists inventory_movements_item_created_idx
  on public.inventory_movements (inventory_item_id, created_at);
create index if not exists inventory_movements_created_idx
  on public.inventory_movements (created_at);

drop function if exists public.inventory_history(timestamptz, timestamptz);

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
      from public.admin_audit_logs a, gate
     where gate.ok
       and a.target_table = 'inventory_items'
       and a.created_at >= p_from and a.created_at <= p_to
  ),
  changed as (
    select * from audit_rows where delta <> 0
  ),
  mv_window as (
    select m.id, m.inventory_item_id, m.delta, m.created_at, m.reason, m.ref_table, m.ref_id
      from public.inventory_movements m
     where m.created_at >= p_from - interval '5 seconds'
       and m.created_at <= p_to + interval '5 seconds'
  ),
  matched as (
    select distinct on (c.id)
           c.id as audit_id, mv.id as mv_id, mv.reason, mv.ref_table, mv.ref_id
      from changed c
      join mv_window mv
        on mv.inventory_item_id = c.item_uuid
       and mv.created_at between c.created_at - interval '5 seconds' and c.created_at + interval '5 seconds'
       and abs(mv.delta - c.delta) < 0.0005
     order by c.id, abs(extract(epoch from (mv.created_at - c.created_at)))
  ),
  from_audit as (
    select 'a' || r.id::text as id, r.created_at,
           r.item_uuid as inventory_item_id,
           coalesce(i.name, r.snap->>'name') as item_name,
           coalesce(i.unit, r.snap->>'unit') as unit,
           r.delta,
           coalesce(mt.reason,
                    case r.action when 'inventory_items.create' then 'new item'
                                  when 'inventory_items.delete' then 'item deleted'
                                  else 'manual adjustment' end) as reason,
           mt.ref_table, mt.ref_id, r.actor_id,
           nullif(p.full_name, '') as user_name,
           coalesce(r.actor_email, u.email::text) as user_email,
           case when mt.mv_id is not null
                 and (coalesce(mt.ref_table,'') in ('orders','order_items','refunds','voids')
                      or mt.reason in ('order','refund','void','sale'))
                then 'Automatic entry' else 'Manual entry' end as entry_type
      from changed r
      left join matched mt on mt.audit_id = r.id
      left join public.inventory_items i on i.id = r.item_uuid
      left join auth.users u on u.id = r.actor_id
      left join public.profiles p on p.id = r.actor_id
  ),
  from_legacy as (
    select 'm' || m.id::text as id, m.created_at, m.inventory_item_id,
           i.name as item_name, i.unit, m.delta, m.reason, m.ref_table, m.ref_id, m.actor_id,
           nullif(p.full_name, '') as user_name, u.email::text as user_email,
           case when coalesce(m.ref_table,'') in ('orders','order_items','refunds','voids')
                  or m.reason in ('order','refund','void','sale')
                then 'Automatic entry' else 'Manual entry' end as entry_type
      from public.inventory_movements m, gate
      left join public.inventory_items i on i.id = m.inventory_item_id
      left join auth.users u on u.id = m.actor_id
      left join public.profiles p on p.id = m.actor_id
     where gate.ok
       and m.created_at >= p_from and m.created_at <= p_to
       and m.created_at < coalesce((select ts from first_audit), 'infinity'::timestamptz)
  )
  select * from (
    select * from from_audit
    union all
    select * from from_legacy
  ) x
  order by x.created_at desc, x.id desc
$$;

grant execute on function public.inventory_history(timestamptz, timestamptz) to authenticated;
notify pgrst, 'reload schema';
