-- Fix: gen_random_bytes(integer) does not exist on this database.
-- Replace _gen_customer_token to use built-in gen_random_uuid() which is always available.

create or replace function public._gen_customer_token()
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');
  return left(v_token, 22);
end $$;
