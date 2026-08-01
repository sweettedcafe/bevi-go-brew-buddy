-- =====================================================================
-- BEVI & GO — Phase 47
-- Analytics now derives revenue exactly like Reports:
--   revenue = SUM(orders.total) over non-unpaid orders (void/refund mirrors
--   are already negative, so they subtract), NOT a prorated sum of line
--   totals. Line-level math is used only for qty and top items.
--   Order count = sales that are not voided/refunded, same as Reports.
-- When owner/category/item filters are applied, only orders containing a
-- matching line are included, and revenue is the prorated share of those
-- matching lines.
-- =====================================================================

create or replace function public.pos_analytics(
  p_from date,
  p_to date,
  p_owner_id uuid default null,
  p_category_id uuid default null,
  p_menu_item_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_tz text := 'Asia/Manila';
  v_from timestamptz := (p_from::timestamp) at time zone v_tz;
  v_to   timestamptz := ((p_to + 1)::timestamp) at time zone v_tz;
  v_filtered boolean := (p_owner_id is not null or p_category_id is not null or p_menu_item_id is not null);
  v_hours jsonb; v_weekdays jsonb; v_daily jsonb; v_monthly jsonb;
  v_top_items jsonb; v_summary jsonb;
begin
  if not public.is_staff(auth.uid()) then raise exception 'not authorized'; end if;

  with ord as (
    select o.id, o.created_at, coalesce(o.total,0) as total,
           coalesce(o.txn_kind::text,'sale') as kind,
           coalesce(o.status::text,'') as status
      from public.orders o
     where o.created_at >= v_from
       and o.created_at <  v_to
       and coalesce(o.status::text,'') not in ('on_hold','open')
       and (
         not v_filtered
         or exists (
           select 1 from public.order_items oi
             left join public.menu_items mi on mi.id = oi.menu_item_id
            where oi.order_id = o.id
              and (p_owner_id is null     or mi.owner_id = p_owner_id)
              and (p_category_id is null  or mi.category_id = p_category_id)
              and (p_menu_item_id is null or oi.menu_item_id = p_menu_item_id)
         )
       )
  ),
  lines as (
    select o.id as order_id, o.created_at, oi.qty as sqty,
           oi.line_total * case
             when coalesce(ords.subtotal,0) = 0 then 1
             else coalesce(ords.total,0) / ords.subtotal
           end as line_net,
           oi.menu_item_id, oi.name_snapshot
      from ord o
      join public.orders ords on ords.id = o.id
      join public.order_items oi on oi.order_id = o.id
      left join public.menu_items mi on mi.id = oi.menu_item_id
     where (p_owner_id is null     or mi.owner_id = p_owner_id)
       and (p_category_id is null  or mi.category_id = p_category_id)
       and (p_menu_item_id is null or oi.menu_item_id = p_menu_item_id)
  ),
  -- Per-order revenue: order total when unfiltered (matches Reports "Net"),
  -- otherwise the prorated total of the matching lines only.
  rev as (
    select o.id, o.created_at, o.kind, o.status,
           case when v_filtered
                then coalesce((select sum(l.line_net) from lines l where l.order_id = o.id), 0)
                else o.total end as srev,
           case when o.kind = 'sale' and o.status not in ('voided','refunded')
                then o.id else null end as countable_order_id
      from ord o
  ),
  bucketed as (
    select r.created_at, r.srev, r.countable_order_id,
           coalesce((select sum(l.sqty) from lines l where l.order_id = r.id), 0) as sqty
      from rev r
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('h', h, 'orders', orders, 'qty', qty, 'revenue', revenue) order by h)
        from (select extract(hour from (created_at at time zone v_tz))::int as h,
                     count(distinct countable_order_id) as orders,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(srev),0)::numeric, 2) as revenue
                from bucketed group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('d', d, 'orders', orders, 'qty', qty, 'revenue', revenue) order by d)
        from (select extract(dow from (created_at at time zone v_tz))::int as d,
                     count(distinct countable_order_id) as orders,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(srev),0)::numeric, 2) as revenue
                from bucketed group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('day', day, 'orders', orders, 'qty', qty, 'revenue', revenue) order by day)
        from (select (created_at at time zone v_tz)::date as day,
                     count(distinct countable_order_id) as orders,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(srev),0)::numeric, 2) as revenue
                from bucketed group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('month', month, 'orders', orders, 'qty', qty, 'revenue', revenue) order by month)
        from (select to_char((created_at at time zone v_tz), 'YYYY-MM') as month,
                     count(distinct countable_order_id) as orders,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(srev),0)::numeric, 2) as revenue
                from bucketed group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('menu_item_id', menu_item_id, 'name', name, 'qty', qty, 'revenue', revenue) order by qty desc)
        from (select menu_item_id, max(name_snapshot) as name,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(line_net),0)::numeric, 2) as revenue
                from lines where menu_item_id is not null
               group by menu_item_id
               order by sum(sqty) desc nulls last
               limit 10) t), '[]'::jsonb),
    jsonb_build_object(
      'orders', coalesce((select count(distinct countable_order_id) from rev), 0),
      'qty', coalesce((select sum(sqty)::numeric from lines), 0),
      'revenue', round(coalesce((select sum(srev)::numeric from rev), 0), 2),
      'tz', v_tz, 'from', p_from, 'to', p_to)
  into v_hours, v_weekdays, v_daily, v_monthly, v_top_items, v_summary;

  return jsonb_build_object(
    'summary', v_summary,
    'by_hour', v_hours,
    'by_weekday', v_weekdays,
    'by_day', v_daily,
    'by_month', v_monthly,
    'top_items', v_top_items
  );
end $$;

grant execute on function public.pos_analytics(date,date,uuid,uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
