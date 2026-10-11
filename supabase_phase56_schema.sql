-- Phase 56: app-wide settings (used for "required expense fields" in End of Shift).
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_settings enable row level security;
grant select, insert, update on public.app_settings to authenticated;

drop policy if exists "app_settings staff read" on public.app_settings;
create policy "app_settings staff read" on public.app_settings
  for select to authenticated using (public.is_staff(auth.uid()));

drop policy if exists "app_settings admin insert" on public.app_settings;
create policy "app_settings admin insert" on public.app_settings
  for insert to authenticated
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

drop policy if exists "app_settings admin update" on public.app_settings;
create policy "app_settings admin update" on public.app_settings
  for update to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'));

insert into public.app_settings(key, value)
values ('expense_required_fields', '{"description":true,"quantity":true,"unit_price":true,"payment_method":true}'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
