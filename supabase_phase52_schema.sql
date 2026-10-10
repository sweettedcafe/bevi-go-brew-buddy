-- Phase 52: Inventory Historical Report
-- Returns every inventory movement with item name, user and entry type.
-- Manual entry   = changes made from the Inventory page (add/deduct packs, import, edits)
-- Automatic entry = changes created by the system from POS sales / refunds / voids

create or replace function public.inventory_history(p_from timestamptz, p_to timestamptz)
returns table(
  id bigint,
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
  select m.id, m.created_at, m.inventory_item_id, i.name, i.unit, m.delta, m.reason,
         m.ref_table, m.ref_id, m.actor_id,
         nullif(p.full_name, ''), u.email::text,
         case when coalesce(m.ref_table,'') in ('orders','order_items','refunds','voids')
                or m.reason in ('order','refund','void','sale')
              then 'Automatic entry' else 'Manual entry' end
    from public.inventory_movements m
    left join public.inventory_items i on i.id = m.inventory_item_id
    left join auth.users u on u.id = m.actor_id
    left join public.profiles p on p.id = m.actor_id
   where (public.is_staff(auth.uid()))
     and m.created_at >= p_from
     and m.created_at <= p_to
   order by m.created_at desc, m.id desc
$$;

grant execute on function public.inventory_history(timestamptz, timestamptz) to authenticated;
