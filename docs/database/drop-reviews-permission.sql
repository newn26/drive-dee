-- =====================================================================
-- Remove the reviews_moderate admin permission (runs after drop-reviews.sql)
--
-- The review feature and the reviews table are gone, so the permission grants nothing.
-- This removes it everywhere it is stored:
--   1. admin_permission_list(): the known permissions (used by validate_admin_permissions,
--      so the Owner can no longer grant it).
--   2. admin_members / admin_invitations rows: dropped from every permissions array.
--   3. admin_members.permissions default and both CHECK constraints: the 4 remaining ones.
--
-- On 2026-11-15 every row that had reviews_moderate also had other permissions, so no row
-- is left empty (admin_invitations requires at least one). If a row would end up empty the
-- script stops instead of changing anything. No admin_audit_log row mentions it.
-- Re-runnable.
-- =====================================================================

do $$
begin
  if exists (select 1 from public.admin_invitations
             where permissions = array['reviews_moderate']) then
    raise exception 'an invitation has only reviews_moderate; revoke it first';
  end if;
end $$;

create or replace function public.admin_permission_list()
returns text[] language sql immutable set search_path = public as $$
  select array['contracts_manage','contracts_approve','bookings_manage','fleet_manage']
$$;

alter table public.admin_members drop constraint if exists admin_members_permissions_check;
alter table public.admin_invitations drop constraint if exists admin_invitations_permissions_check;

update public.admin_members set permissions = array_remove(permissions, 'reviews_moderate')
  where 'reviews_moderate' = any(permissions);
update public.admin_invitations set permissions = array_remove(permissions, 'reviews_moderate')
  where 'reviews_moderate' = any(permissions);

alter table public.admin_members alter column permissions
  set default array['contracts_manage','contracts_approve','bookings_manage','fleet_manage'];

alter table public.admin_members add constraint admin_members_permissions_check
  check (permissions <@ array['contracts_manage','contracts_approve','bookings_manage','fleet_manage']);
alter table public.admin_invitations add constraint admin_invitations_permissions_check
  check (cardinality(permissions) > 0
         and permissions <@ array['contracts_manage','contracts_approve','bookings_manage','fleet_manage']);
