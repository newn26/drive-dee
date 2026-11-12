# Administrator accounts: Owner, admins and permissions

Applies to the database after migration
[`0004_contract_approval_workflow`](../../drizzle/migrations/0004_contract_approval_workflow.sql)
(applied to production). Everything here is enforced by that migration; the UI only hides
what the database would reject.

## Model

| Who           | Stored in                                                           | Can do                                                                                                                              |
| ------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**     | `user_roles` (`admin`) + `admin_members.is_owner = true`            | Everything, plus invite admins, change permissions, suspend/reactivate/revoke admins, read the audit log, manually confirm bookings |
| **Admin**     | `user_roles` (`admin`) + `admin_members` (`status`, `permissions`)  | Read the admin dashboard; write only what their permissions allow                                                                   |
| Customer      | `user_roles` (`customer`)                                           | Own data only. Every sign-up is a customer                                                                                          |
| Demo Customer | `customer` + `app_metadata.demo = true`, `@demo.siamwheels.invalid` | Never an admin (trigger `prevent_demo_admin` and invitation checks)                                                                 |
| Demo Admin    | —                                                                   | **Disabled.** The `demo_admin` role does not exist in the database and its sign-in is turned off                                    |

- At most **one** Owner (unique index on `admin_members`).
- Permissions: `contracts_manage`, `contracts_approve`, `bookings_manage`, `fleet_manage`,
  `reviews_moderate`. The Owner implicitly has all of them.
- An admin whose `admin_members.status` is `suspended` or `revoked` fails
  `has_role(…, 'admin')`, so every RLS policy and function treats them as a non-admin.
- Clients cannot write `user_roles`, `admin_members`, `admin_invitations` or `admin_audit_log`.
  For signed-in users the `admin` role can only come from an accepted invitation
  (trigger `guard_admin_role_grant`).

These steps are done by the project owner by hand, never by an AI agent, a Lovable prompt, a
migration or application code. Do not paste passwords anywhere; the SQL steps need only an email.
Replace placeholders such as `<OWNER_EMAIL>`; never commit real addresses.

## 1. First admin (one-time, SQL editor)

Status: **done (2026-11-11)** for the current administrator. Only needed again if no admin exists.

Requirements: an email you own that is **already verified**, and not a Demo Customer account.

In Lovable → **Cloud → SQL editor**:

```sql
insert into public.user_roles(user_id, role)
select u.id, 'admin'::app_role from auth.users u
where lower(u.email) = lower('<ADMIN_EMAIL>')
  and u.email_confirmed_at is not null
  and coalesce(u.raw_app_meta_data->>'demo','false') <> 'true'
on conflict (user_id, role) do nothing
returning user_id;
```

- One row returned → granted. No row → nothing granted (not found, not verified, demo, or
  already admin).
- The SQL editor has no signed-in user, so `guard_admin_role_grant` allows it. Trigger
  `track_admin_member` creates an `admin_members` row (`active`, all permissions, **not Owner**)
  and logs `admin_role_granted` with `source = sql_or_service`.

## 2. Owner bootstrap (one-time privileged setup)

Makes one existing, active admin the Owner. In the SQL editor:

```sql
select public.bootstrap_owner('<OWNER_EMAIL>');
```

`bootstrap_owner` refuses to run when:

- called by a signed-in user (it works only from the SQL editor or the service role; API roles
  have no `EXECUTE` on it);
- an Owner already exists;
- the account does not exist or is not an active admin.

It logs `owner_bootstrapped`. Check the result:

```sql
select email, is_owner, status, permissions from public.admin_members order by created_at;
```

After this, sign out and back in: the Owner sees the **ผู้ดูแลระบบ (Owner)** tab in `/admin`.

There is no function to transfer or remove the Owner. Changing the Owner later would need a new,
reviewed migration.

## 3. Inviting an admin (Owner, in the app)

1. In `/admin` → **ผู้ดูแลระบบ (Owner)**, enter the person's email and tick at least one
   permission.
2. The database (`owner_create_admin_invitation`) creates a random token, stores only its
   SHA-256 hash and returns the token **once**. The page shows the link
   `/admin-invite?token=…` with a copy button.
3. Send the link to the person through your own channel. The app does not send email.
4. The person signs in (or signs up and verifies) **with the invited email**, opens the link
   and presses accept (`accept_admin_invitation`).

Rules enforced by the database:

| Rule               | Detail                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Expiry             | 72 hours after creation                                                                                       |
| Single use         | `accepted_at` is set on acceptance; the token cannot be used again                                            |
| Bound to email     | The signed-in account's email must equal the invited email (case-insensitive)                                 |
| No demo accounts   | `@demo.siamwheels.invalid` emails and accounts with `app_metadata.demo` are refused                           |
| One open per email | Creating a new invitation revokes the previous open one for that email                                        |
| Existing admins    | Refused if the email already belongs to an `active` or `suspended` admin. A `revoked` admin can be re-invited |
| Errors             | Unknown, expired, used, revoked and wrong-account tokens all give the same message                            |

The Owner can revoke an open invitation from the invitation list (`owner_revoke_admin_invitation`).

## 4. Changing permissions (Owner, in the app)

Edit an admin's permissions in the Owner tab (`owner_set_admin_permissions`). The set must
contain at least one known permission. The Owner's own permissions cannot be changed. Logged as
`permissions_changed` with the old and new sets.

## 5. Suspending, reactivating and revoking (Owner, in the app)

Use the actions on an admin's row (`owner_set_admin_status`). A reason of at least 5 characters
is required.

| From                   | To          | Effect                                                         | Audit action        |
| ---------------------- | ----------- | -------------------------------------------------------------- | ------------------- |
| `active`               | `suspended` | All admin access stops immediately                             | `admin_suspended`   |
| `suspended`            | `active`    | Access restored with the existing permissions                  | `admin_reactivated` |
| `active` / `suspended` | `revoked`   | `admin` row deleted from `user_roles`; access ends permanently | `admin_revoked`     |

The Owner cannot change their own status, and the Owner's status cannot be changed by anyone.

**Emergency only (SQL editor).** If the app cannot be used, an admin role can be removed with
`delete from public.user_roles where role = 'admin' and user_id = '<USER_ID>';`. This takes effect
immediately but is **not audited** and leaves the `admin_members` row as `active`. Prefer the
Owner tab whenever possible.

## 6. Audit log

`admin_audit_log` is append-only (trigger `append_only` rejects updates and deletes) and only the
Owner can read it (the Owner tab shows the latest 100 entries). Actions:
`admin_role_granted`, `owner_bootstrapped`, `invite_created`, `invite_revoked`,
`invite_accepted`, `permissions_changed`, `admin_suspended`, `admin_reactivated`,
`admin_revoked`, `booking_manual_confirm`. Invitation tokens are never written to the log.

`admin_members` and `admin_invitations` are **not** append-only: the Owner functions update
their status, permission and acceptance/revocation columns. Their history is kept in the audit
log.

## Check current admins (read-only)

```sql
select m.email, m.is_owner, m.status, m.permissions, m.status_reason
from public.admin_members m order by m.created_at;
```
