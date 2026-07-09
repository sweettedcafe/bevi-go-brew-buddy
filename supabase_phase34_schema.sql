-- =====================================================================
-- BEVI & GO — Phase 34: ensure baristas can void / refund orders
-- =====================================================================
-- Redefines the permission helper used by pos_void_order_v2,
-- pos_refund_order_v2, and _reverse_order_item so that the "barista"
-- role is authorized to reverse orders alongside admin and developer.

create or replace function public._can_reverse_order(p_uid uuid)
returns boolean language sql stable as $fn_rev$
  select public.has_role(p_uid, 'admin')
      or public.has_role(p_uid, 'developer')
      or public.has_role(p_uid, 'barista');
$fn_rev$;

notify pgrst, 'reload schema';
