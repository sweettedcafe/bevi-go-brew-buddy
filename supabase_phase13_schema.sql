-- =====================================================================
-- BEVI & GO — Phase 13: System-wide audit trail
-- Adds generic trigger that writes every INSERT / UPDATE / DELETE on
-- core tables into public.admin_audit_logs (already created in phase 1).
-- Re-run safe.
-- =====================================================================

-- Generic audit trigger function
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_email      text;
  v_role       public.app_role;
  v_before     jsonb;
  v_after      jsonb;
  v_target_id  text;
  v_action     text;
begin
  -- best-effort actor metadata (skip if not available, e.g. service role)
  begin
    select email into v_email from auth.users where id = v_actor;
  exception when others then v_email := null;
  end;

  begin
    select role into v_role
    from public.user_roles
    where user_id = v_actor
    order by case role when 'developer' then 1 when 'admin' then 2 else 3 end
    limit 1;
  exception when others then v_role := null;
  end;

  if (tg_op = 'INSERT') then
    v_before := null;
    v_after  := to_jsonb(new);
    v_target_id := coalesce((to_jsonb(new)->>'id'), null);
    v_action := tg_table_name || '.create';
  elsif (tg_op = 'UPDATE') then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_target_id := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'));
    v_action := tg_table_name || '.update';
    -- skip pure no-op updates
    if v_before = v_after then
      return new;
    end if;
  elsif (tg_op = 'DELETE') then
    v_before := to_jsonb(old);
    v_after  := null;
    v_target_id := coalesce((to_jsonb(old)->>'id'), null);
    v_action := tg_table_name || '.delete';
  end if;

  insert into public.admin_audit_logs (
    actor_id, actor_email, actor_role,
    action, target_table, target_id,
    before_data, after_data
  ) values (
    v_actor, v_email, v_role,
    v_action, tg_table_name, v_target_id,
    v_before, v_after
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- Helper to attach the trigger to a table only if the table exists.
create or replace function public._attach_audit(_table text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = _table
  ) then
    return;
  end if;
  execute format('drop trigger if exists trg_audit_%I on public.%I', _table, _table);
  execute format(
    'create trigger trg_audit_%I after insert or update or delete on public.%I
       for each row execute function public.audit_row_change()',
    _table, _table
  );
end;
$$;

-- Attach to every meaningful table. Add new ones here when introduced.
select public._attach_audit(t) from (values
  ('menu_items'),
  ('menu_item_options'),
  ('recipes'),
  ('inventory_items'),
  ('discounts'),
  ('bundles'),
  ('bundle_items'),
  ('customers'),
  ('staff'),
  ('payment_methods'),
  ('print_settings'),
  ('user_roles'),
  ('profiles'),
  ('shifts'),
  ('shift_expenses'),
  ('time_entries'),
  ('leaves')
) as x(t);

-- Read access already exists for admins/devs (phase 1).
