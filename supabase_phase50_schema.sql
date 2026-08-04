-- =====================================================================
-- BEVI & GO — Phase 50
-- Align Analytics revenue with the new Reports "Per item" definition:
--
--   Gross sale = unit_price * qty
--   Net sale   = Gross sale − discount share − payment fee share
--
-- Order-level discounts and payment fees are prorated across the lines
-- of the order by each line's gross value (same math as the report UI).
-- Void/refund mirror rows keep their stored negative values, so a void
-- cancels its parent sale exactly like in Reports.
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

  with scope as (
    select o.id, o.created_at, o.status::text as status,
           coalesce(o.txn_kind::text,'sale') as kind,
           coalesce(o.discount_total,0) as discount_total
      from public.orders o
     where o.created_at >= v_from
       and o.created_at <  v_to
       and coalesce(o.status::text,'') not in ('on_hold','open')
  ),
  order_gross as (
    -- full order gross (all lines, unfiltered) drives the proration
    select oi.order_id, sum(oi.unit_price * oi.qty) as gross_sum
      from public.order_items oi
      join scope s on s.id = oi.order_id
     group by oi.order_id
  ),
  order_fee as (
    select p.order_id, sum(coalesce(p.fee_amount,0)) as fee_total
      from public.order_payments p
      join scope s on s.id = p.order_id
     group by p.order_id
  ),
  base as (
    select s.id, s.created_at, s.status, s.kind,
           oi.qty as sqty,
           (oi.unit_price * oi.qty)
             - (s.discount_total + coalesce(f.fee_total,0))
               * case when coalesce(g.gross_sum,0) = 0 then 0
                      else (oi.unit_price * oi.qty) / g.gross_sum end
             as srev,
           case
             when s.kind = 'sale'
              and coalesce(s.status,'') not in ('voided','refunded')
             then s.id
             else null
           end as countable_order_id,
           mi.owner_id, mi.category_id, oi.menu_item_id, oi.name_snapshot
      from scope s
      join public.order_items oi on oi.order_id = s.id
      left join order_gross g on g.order_id = s.id
      left join order_fee   f on f.order_id = s.id
      left join public.menu_items mi on mi.id = oi.menu_item_id
     where (p_owner_id is null     or mi.owner_id = p_owner_id)
       and (p_category_id is null  or mi.category_id = p_category_id)
       and (p_menu_item_id is null or oi.menu_item_id = p_menu_item_id)
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('h', h, 'orders', orders, 'qty', qty, 'revenue', revenue) order by h)
        from (select extract(hour from (created_at at time zone v_tz))::int as h,
                     count(distinct countable_order_id) as orders,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(srev),0)::numeric, 2) as revenue
                from base group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('d', d, 'orders', orders, 'qty', qty, 'revenue', revenue) order by d)
        from (select extract(dow from (created_at at time zone v_tz))::int as d,
                     count(distinct countable_order_id) as orders,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(srev),0)::numeric, 2) as revenue
                from base group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('day', day, 'orders', orders, 'qty', qty, 'revenue', revenue) order by day)
        from (select (created_at at time zone v_tz)::date as day,
                     count(distinct countable_order_id) as orders,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(srev),0)::numeric, 2) as revenue
                from base group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('month', month, 'orders', orders, 'qty', qty, 'revenue', revenue) order by month)
        from (select to_char((created_at at time zone v_tz), 'YYYY-MM') as month,
                     count(distinct countable_order_id) as orders,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(srev),0)::numeric, 2) as revenue
                from base group by 1) t), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('menu_item_id', menu_item_id, 'name', name, 'qty', qty, 'revenue', revenue) order by qty desc)
        from (select menu_item_id, max(name_snapshot) as name,
                     coalesce(sum(sqty),0)::numeric as qty,
                     round(coalesce(sum(srev),0)::numeric, 2) as revenue
                from base where menu_item_id is not null
               group by menu_item_id
               order by sum(sqty) desc nulls last
               limit 10) t), '[]'::jsonb),
    jsonb_build_object(
      'orders', coalesce((select count(distinct countable_order_id) from base), 0),
      'qty', coalesce((select sum(sqty)::numeric from base), 0),
      'revenue', round(coalesce((select sum(srev)::numeric from base), 0), 2),
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
