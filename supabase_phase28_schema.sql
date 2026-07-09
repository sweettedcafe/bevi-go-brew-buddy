-- =====================================================================
-- Phase 28 — Role access grants
-- Lets admins/developers grant additional menu paths to non-developer roles
-- (e.g. give "barista" access to "/end-of-shift").
-- =====================================================================

create table if not exists public.role_access_grants (
  id          uuid primary key default gen_random_uuid(),
  role        public.app_role not null,
  path        text not null,
  granted_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (role, path)
);

alter table public.role_access_grants enable row level security;

grant select, insert, delete on public.role_access_grants to authenticated;

-- Any authenticated user can read grants (the layout needs them to render nav).
drop policy if exists "grants read" on public.role_access_grants;
create policy "grants read" on public.role_access_grants
  for select to authenticated using (true);

-- Only admin/developer may write, and never for the developer role itself.
drop policy if exists "grants write admin" on public.role_access_grants;
create policy "grants write admin" on public.role_access_grants
  for insert to authenticated
  with check (
    (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
    and role <> 'developer'
  );

drop policy if exists "grants delete admin" on public.role_access_grants;
create policy "grants delete admin" on public.role_access_grants
  for delete to authenticated
  using (
    (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'developer'))
    and role <> 'developer'
  );
