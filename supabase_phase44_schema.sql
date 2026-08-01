-- =====================================================================
-- BEVI & GO — Phase 44
-- Make Analytics match Reports exactly:
--   1. Exclude unpaid orders (on_hold / open) — Reports never counts them.
--   2. Apply order-level discounts proportionally so revenue = net (o.total),
--      not the raw line subtotal.
--   3. Keep signing by txn_kind only (sale positive, void/refund mirror
--      negative) so a voided sale counts first and the mirror cancels it —
--      identical to the Reports "signed totals" logic.
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
  v_hours jsonb; v_weekdays jsonb; v_daily jsonb; v_monthly jsonb;
  v_top_items jsonb; v_summary jsonb;
begin
  if not public.is_staff(auth.uid()) then raise exception 'not authorized'; end if;

  with base as (
    select o.id, o.created_at, oi.qty,
           -- net of order-level discounts, prorated across lines
           oi.line_total * case
             when coalesce(o.subtotal,0) = 0 then 1
             else coalesce(o.total,0) / o.subtotal
           end as line_net,
           coalesce(o.txn_kind,'sale') as kind, o.status,
           mi.owner_id, mi.category_id, oi.menu_item_id, oi.name_snapshot
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      left join public.menu_items mi on mi.id = oi.menu_item_id
     where o.created_at >= v_from
       and o.created_at <  v_to
       and coalesce(o.status,'') not in ('on_hold','open')   -- unpaid: excluded
       and (p_owner_id is null    or mi.owner_id = p_owner_id)
       and (p_category_id is null or mi.category_id = p_category_id)
       and (p_menu_item_id is null or oi.menu_item_id = p_menu_item_id)
  ),
  signed as (
    select *,
      case when kind in ('void','refund') then -qty else qty end as sqty,
      case when kind in ('void','refund') then -line_net else line_net end as srev
    from base
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('h', h, 'orders', orders, 'qty', qty, 'revenue', revenue) order by h)
        from (select extract(hour from (created_at at time zone v_tz))::int as h,
                     count(distinct id) as orders,
                     sum(sqty)::numeric as qty,
                     round(sum(srev)::numeric, 2) as revenue
                from signed group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('d', d, 'orders', orders, 'qty', qty, 'revenue', revenue) order by d)
        from (select extract(dow from (created_at at time zone v_tz))::int as d,
                     count(distinct id) as orders,
                     sum(sqty)::numeric as qty,
                     round(sum(srev)::numeric, 2) as revenue
                from signed group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('day', day, 'orders', orders, 'qty', qty, 'revenue', revenue) order by day)
        from (select (created_at at time zone v_tz)::date as day,
                     count(distinct id) as orders,
                     sum(sqty)::numeric as qty,
                     round(sum(srev)::numeric, 2) as revenue
                from signed group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('month', month, 'orders', orders, 'qty', qty, 'revenue', revenue) order by month)
        from (select to_char((created_at at time zone v_tz), 'YYYY-MM') as month,
                     count(distinct id) as orders,
                     sum(sqty)::numeric as qty,
                     round(sum(srev)::numeric, 2) as revenue
                from signed group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('menu_item_id', menu_item_id, 'name', name, 'qty', qty, 'revenue', revenue) order by qty desc)
        from (select menu_item_id, max(name_snapshot) as name,
                     sum(sqty)::numeric as qty, round(sum(srev)::numeric, 2) as revenue
                from signed where menu_item_id is not null
               group by menu_item_id
               order by sum(sqty) desc nulls last
               limit 10) t), '[]'::jsonb),
    jsonb_build_object(
      'orders', coalesce((select count(distinct id) from signed
                           where kind not in ('void','refund')
                             and coalesce(status,'') not in ('voided','refunded')), 0),
      'qty',    coalesce((select sum(sqty)::numeric from signed), 0),
      'revenue', round(coalesce((select sum(srev)::numeric from signed), 0), 2),
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
