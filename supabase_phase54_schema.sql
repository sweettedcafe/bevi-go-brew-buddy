-- Phase 54: Inventory Historical Report now reads from the audit log.
-- Source of truth: admin_audit_logs rows for inventory_items (stock_qty before -> after).
-- Entry type: "Automatic entry" when a matching POS stock movement (order/refund/void)
-- exists at the same moment; otherwise "Manual entry".
-- Any movements recorded BEFORE the audit trigger started logging inventory_items
-- are included too, so history is complete from the first day of use (August).

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
language sql stable security definer set search_path = public, auth as $$
  with first_audit as (
    select min(a.created_at) as ts
      from public.admin_audit_logs a
     where a.target_table = 'inventory_items'
  ),
  audit_rows as (
    select a.id, a.created_at, a.target_id, a.actor_id, a.actor_email, a.action,
           coalesce(a.after_data, a.before_data) as snap,
           case
             when a.action = 'inventory_items.create' then coalesce((a.after_data->>'stock_qty')::numeric, 0)
             when a.action = 'inventory_items.delete' then -coalesce((a.before_data->>'stock_qty')::numeric, 0)
             else coalesce((a.after_data->>'stock_qty')::numeric, 0)
                - coalesce((a.before_data->>'stock_qty')::numeric, 0)
           end as delta
      from public.admin_audit_logs a
     where a.target_table = 'inventory_items'
       and a.created_at >= p_from and a.created_at <= p_to
  ),
  from_audit as (
    select 'a' || r.id::text as id, r.created_at,
           nullif(r.target_id, '')::uuid as inventory_item_id,
           coalesce(i.name, r.snap->>'name') as item_name,
           coalesce(i.unit, r.snap->>'unit') as unit,
           r.delta,
           coalesce(mv.reason,
                    case r.action when 'inventory_items.create' then 'new item'
                                  when 'inventory_items.delete' then 'item deleted'
                                  else 'manual adjustment' end) as reason,
           mv.ref_table, mv.ref_id, r.actor_id,
           nullif(p.full_name, '') as user_name,
           coalesce(r.actor_email, u.email::text) as user_email,
           case when mv.id is not null
                 and (coalesce(mv.ref_table,'') in ('orders','order_items','refunds','voids')
                      or mv.reason in ('order','refund','void','sale'))
                then 'Automatic entry' else 'Manual entry' end as entry_type
      from audit_rows r
      left join public.inventory_items i on i.id::text = r.target_id
      left join auth.users u on u.id = r.actor_id
      left join public.profiles p on p.id = r.actor_id
      left join lateral (
        select m.id, m.reason, m.ref_table, m.ref_id
          from public.inventory_movements m
         where m.inventory_item_id::text = r.target_id
           and abs(m.delta - r.delta) < 0.0005
           and abs(extract(epoch from (m.created_at - r.created_at))) <= 5
         order by abs(extract(epoch from (m.created_at - r.created_at)))
         limit 1
      ) mv on true
     where r.delta <> 0
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
     where m.created_at >= p_from and m.created_at <= p_to
       and m.created_at < coalesce((select ts from first_audit), 'infinity'::timestamptz)
  )
  select * from (
    select * from from_audit
    union all
    select * from from_legacy
  ) x
  where public.is_staff(auth.uid())
  order by x.created_at desc, x.id desc
$$;

grant execute on function public.inventory_history(timestamptz, timestamptz) to authenticated;
notify pgrst, 'reload schema';
