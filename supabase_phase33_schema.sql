-- =====================================================================
-- BEVI & GO — Phase 33: developer reset for shift_expenses
-- Adds dev_reset_expenses RPC. Run after phase 32.
-- =====================================================================

create or replace function public.dev_reset_expenses()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count int;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if not public.has_role(v_actor, 'developer') then
    raise exception 'only developers can reset expenses';
  end if;

  delete from public.shift_expenses where true;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_expenses', v_count);
end
$$;
revoke all on function public.dev_reset_expenses() from public, anon, authenticated;
grant execute on function public.dev_reset_expenses() to authenticated;

notify pgrst, 'reload schema';
