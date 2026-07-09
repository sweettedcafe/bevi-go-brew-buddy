-- =====================================================================
-- BEVI & GO — Phase 33: developer resets for expenses + timeclock
-- Adds dev_reset_expenses and dev_reset_timeclock RPCs.
-- Run after phase 32.
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

create or replace function public.dev_reset_timeclock()
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
    raise exception 'only developers can reset the timeclock';
  end if;

  -- shift_expenses & shift_breaks reference shifts; clear them first
  delete from public.shift_expenses where true;
  begin delete from public.shift_breaks where true; exception when undefined_table then null; end;
  delete from public.shifts where true;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_shifts', v_count);
end
$$;
revoke all on function public.dev_reset_timeclock() from public, anon, authenticated;
grant execute on function public.dev_reset_timeclock() to authenticated;

notify pgrst, 'reload schema';
