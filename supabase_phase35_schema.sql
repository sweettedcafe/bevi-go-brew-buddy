-- =====================================================================
-- BEVI & GO — Phase 35
--   Walk-in QR flow: customers scan an in-store QR that opens /welcome,
--   enter their email; if registered they are routed to their ordering
--   page (/o/<token>), otherwise sent to /register to sign up.
-- Idempotent; safe to re-run.
-- =====================================================================

create or replace function public.customer_token_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
  v_name  text;
begin
  if v_email = '' or v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return jsonb_build_object('found', false, 'reason', 'invalid_email');
  end if;

  select token, name into v_token, v_name
    from public.customers
   where deleted_at is null
     and lower(trim(email)) = v_email
   limit 1;

  if not found or v_token is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object('found', true, 'token', v_token, 'name', v_name);
end $$;

grant execute on function public.customer_token_by_email(text) to anon, authenticated;

notify pgrst, 'reload schema';
