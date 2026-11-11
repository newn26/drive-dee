create or replace function public.prevent_demo_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'admin' and exists (
    select 1 from auth.users u where u.id = new.user_id
      and (coalesce(u.raw_app_meta_data->>'demo','false') = 'true' or lower(u.email) like '%@demo.siamwheels.invalid')
  ) then
    raise exception 'Demo accounts cannot be granted admin';
  end if;
  return new;
end; $$;
create trigger user_roles_no_demo_admin before insert or update on public.user_roles
for each row execute function public.prevent_demo_admin();