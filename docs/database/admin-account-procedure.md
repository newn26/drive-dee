# Assigning the real administrator – owner-only procedure

Status: **NOT DONE.** There are 0 admins today. This is done by the project owner by hand,
never by an AI agent, a Lovable prompt, a migration, or app code.

Why by hand: `admin` has full access (delete cars, edit contracts, moderate reviews, read every
customer). Public sign-up only ever creates `customer`, and the browser cannot write to
`user_roles` (authenticated users have SELECT only), so this SQL is the only way in.

## Before you start
- Use an email you own and have **already verified** (signed up and clicked the confirmation
  link, or created in Lovable → Cloud → Users with auto-confirm).
- Do **not** use a Demo Customer account or any `@demo.siamwheels.invalid` email – a database
  trigger rejects admin for those.
- Do not paste passwords anywhere. This step needs only the email.

## Steps
1. Open Lovable → **Cloud → SQL editor** for the Siam Wheels Rental Hub project.
2. Replace `<ADMIN_EMAIL>` and run:

```sql
insert into public.user_roles(user_id, role)
select u.id, 'admin'::app_role from auth.users u
where lower(u.email) = lower('<ADMIN_EMAIL>')
  and u.email_confirmed_at is not null
  and coalesce(u.raw_app_meta_data->>'demo','false') <> 'true'
on conflict (user_id, role) do nothing
returning user_id;
```

   - One row returned → granted.
   - No row → nothing was granted (email not found, not verified, demo account, or already admin).

3. Check:

```sql
select u.email, r.role from public.user_roles r join auth.users u on u.id = r.user_id
where r.role::text in ('admin', 'demo_admin') order by r.role;
```

4. Sign out and back in on `/auth`. You should land on `/admin`.

## Revoke
```sql
delete from public.user_roles where role = 'admin' and user_id = '<user id>';
```

Keep exactly one real admin. Never give `admin` to the account used for client demos – use
`demo_admin` for that (see `demo-admin-lovable-prompt.md`, Step 3).
