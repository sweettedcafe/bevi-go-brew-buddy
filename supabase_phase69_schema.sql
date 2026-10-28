-- Phase 69: When an order is voided (or refunded), its loyalty points are voided too.
-- Points earned are taken back; points the customer redeemed on it are returned.
create or replace function public.orders_void_points()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('voided','refunded') and coalesce(old.status,'') not in ('voided','refunded')
     and new.customer_id is not null
     and (coalesce(new.points_earned,0) <> 0 or coalesce(new.points_redeemed,0) <> 0) then
    update public.customers
       set points = greatest(0, points - coalesce(new.points_earned,0) + coalesce(new.points_redeemed,0)),
           updated_at = now()
     where id = new.customer_id;
    new.points_earned := 0;
    new.points_redeemed := 0;
  end if;
  return new;
end; $$;

drop trigger if exists trg_orders_void_points on public.orders;
create trigger trg_orders_void_points
  before update of status on public.orders
  for each row execute function public.orders_void_points();

-- One-time fix for orders already voided that still hold points.
do $$
declare r record;
begin
  for r in select id, customer_id, coalesce(points_earned,0) e, coalesce(points_redeemed,0) d
             from public.orders
            where status in ('voided','refunded') and customer_id is not null
              and (coalesce(points_earned,0) <> 0 or coalesce(points_redeemed,0) <> 0) loop
    update public.customers set points = greatest(0, points - r.e + r.d), updated_at = now()
     where id = r.customer_id;
    update public.orders set points_earned = 0, points_redeemed = 0 where id = r.id;
  end loop;
end $$;
