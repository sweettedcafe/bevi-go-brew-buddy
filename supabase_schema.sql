-- =====================================================================
-- BEVI & GO — Coffee Shop Enterprise Platform
-- Phase 1: Foundation schema (RBAC, audit log, immutable history skeleton)
-- Target: Supabase (PostgreSQL)
-- Run this file in the Supabase SQL Editor of project: pwixzaejussrgxanxeyf
-- =====================================================================

-- ---------- 1. ROLES ENUM ---------------------------------------------
do $$ begin
  create type public.app_role as enum ('developer', 'admin', 'barista');
exception when duplicate_object then null; end $$;

-- ---------- 2. USER_ROLES (separate table — never on profiles!) -------
create table if not exists public.user_roles (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

-- ---------- 3. SECURITY DEFINER role-check (prevents RLS recursion) ---
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id);
$$;

-- ---------- 4. PROFILES (optional metadata, not auth-critical) --------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 5. ADMIN AUDIT LOG (immutable, append-only) ---------------
create table if not exists public.admin_audit_logs (
  id            bigserial primary key,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_email   text,
  actor_role    public.app_role,
  action        text not null,        -- e.g. 'menu.item.update'
  target_table  text,
  target_id     text,
  before_data   jsonb,
  after_data    jsonb,
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

alter table public.admin_audit_logs enable row level security;

-- ---------- API PRIVILEGES ---------------------------------------------
-- RLS policies decide which rows are visible, but authenticated users also
-- need table privileges for the app/API to read and write allowed rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.admin_audit_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_staff(uuid) to authenticated;

-- Block any UPDATE or DELETE (immutability)
create or replace function public.block_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit_logs is append-only (no % allowed)', tg_op;
end; $$;

drop trigger if exists prevent_audit_update on public.admin_audit_logs;
create trigger prevent_audit_update before update on public.admin_audit_logs
  for each row execute function public.block_audit_mutation();

drop trigger if exists prevent_audit_delete on public.admin_audit_logs;
create trigger prevent_audit_delete before delete on public.admin_audit_logs
  for each row execute function public.block_audit_mutation();

-- ---------- 6. RLS POLICIES -------------------------------------------

-- user_roles: users see their own; admins & devs see all; only devs may write
drop policy if exists "user_roles self read"    on public.user_roles;
drop policy if exists "user_roles staff read"   on public.user_roles;
drop policy if exists "user_roles dev manage"   on public.user_roles;
drop policy if exists "user_roles admin manage" on public.user_roles;

create policy "user_roles self read" on public.user_roles
  for select to authenticated using (user_id = auth.uid());

create policy "user_roles staff read" on public.user_roles
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'));

-- Developers: full control. Admins: insert/update only (cannot drop developer rows — enforced at app level too).
create policy "user_roles dev manage" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(), 'developer'))
  with check (public.has_role(auth.uid(), 'developer'));

create policy "user_roles admin manage" on public.user_roles
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and role <> 'developer');

-- profiles
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
drop policy if exists "profiles staff read"  on public.profiles;

create policy "profiles self read" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "profiles self update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles staff read" on public.profiles
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'));

-- audit logs: staff may read; everyone may insert (only triggers/app should, but we allow inserts from authenticated)
drop policy if exists "audit staff read" on public.admin_audit_logs;
drop policy if exists "audit insert"     on public.admin_audit_logs;

create policy "audit staff read" on public.admin_audit_logs
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'developer'));

create policy "audit insert" on public.admin_audit_logs
  for insert to authenticated with check (true);

-- =====================================================================
-- SEED — bootstrap your first DEVELOPER user.
-- After signing up via the web app, run:
--   insert into public.user_roles (user_id, role)
--   values ('<paste-your-auth-user-id-from-auth.users>', 'developer');
-- (You can find the id under Authentication → Users in the Supabase dashboard.)
-- =====================================================================
