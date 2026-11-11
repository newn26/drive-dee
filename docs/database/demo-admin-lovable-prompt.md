# Demo Admin role – Lovable prompt

Status: **NOT APPLIED.** Apply **after** `prototype-lovable-prompt.md` (this prompt replaces
`validate_booking` again, on top of that version). The prototype prompt is live as Lovable
migration 0002; Lovable's migration 0003 (Demo Customer admin block) is also live, and Step 2
below extends its trigger to cover `demo_admin`.

What it changes: adds the `demo_admin` value to `app_role`, one helper function, and new
**additive** RLS policies. Existing policies, tables, columns and rows are not changed or
deleted. Public sign-up still only ever creates `customer` (see `handle_new_user` in the
prototype prompt); `demo_admin` can only be granted by the owner with the SQL in Step 3.

## What the demo admin can and cannot do (enforced by the database)

| Table | Demo admin | Why |
|---|---|---|
| cars | read, insert, update | **no delete** (no delete policy) |
| bookings | read, update status only | dates, amount, car, customer, code are locked by the trigger |
| maintenance | read, insert, update | **no delete** |
| contracts | read only | no update policy for demo admin |
| payments | read only | for reports |
| profiles | read only | customer names on bookings/reports; cannot edit anyone's profile |
| user_roles | read only | to count customers; **no insert/update/delete grant exists**, so no role changes |
| reviews | public read only | **no delete** (delete stays admin-only) |
| auth.users / secrets | no access | the browser client never sees them |

---

## Step 1 – add the role value (run on its own)

> Please run this single statement as its own migration. Do not change anything else.

```sql
alter type public.app_role add value if not exists 'demo_admin';
```

(A new enum value must be committed before other SQL can use it, so this runs separately.)

## Step 2 – helper, policies and booking trigger

> Please apply this migration for the Siam Wheels demo prototype. It only adds a helper
> function and new RLS policies for the `demo_admin` role, and replaces `validate_booking`.
> Do not drop or change any existing policy, table, column or row. Use exactly this SQL:

```sql
-- True only for demo admins (a real admin is never treated as a demo admin).
create or replace function public.is_demo_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role::text = 'demo_admin')
     and not exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin')
$$;
revoke all on function public.is_demo_admin(uuid) from public, anon;
grant execute on function public.is_demo_admin(uuid) to authenticated;

-- Read access for the dashboard and reports
create policy "demo admin read profiles"    on public.profiles    for select to authenticated using (public.is_demo_admin(auth.uid()));
create policy "demo admin read roles"       on public.user_roles  for select to authenticated using (public.is_demo_admin(auth.uid()));
create policy "demo admin read bookings"    on public.bookings    for select to authenticated using (public.is_demo_admin(auth.uid()));
create policy "demo admin read payments"    on public.payments    for select to authenticated using (public.is_demo_admin(auth.uid()));
create policy "demo admin read contracts"   on public.contracts   for select to authenticated using (public.is_demo_admin(auth.uid()));
create policy "demo admin read maintenance" on public.maintenance for select to authenticated using (public.is_demo_admin(auth.uid()));

-- Cars: add and edit, never delete
create policy "demo admin insert cars" on public.cars for insert to authenticated
  with check (public.is_demo_admin(auth.uid()));
create policy "demo admin update cars" on public.cars for update to authenticated
  using (public.is_demo_admin(auth.uid())) with check (public.is_demo_admin(auth.uid()));

-- Bookings: status updates (other fields are locked by validate_booking below)
create policy "demo admin update bookings" on public.bookings for update to authenticated
  using (public.is_demo_admin(auth.uid())) with check (public.is_demo_admin(auth.uid()));

-- Maintenance: add and update, never delete
create policy "demo admin insert maintenance" on public.maintenance for insert to authenticated
  with check (public.is_demo_admin(auth.uid()));
create policy "demo admin update maintenance" on public.maintenance for update to authenticated
  using (public.is_demo_admin(auth.uid())) with check (public.is_demo_admin(auth.uid()));

-- Bookings trigger: same as the prototype version, plus
--  * a demo admin may change the status of any booking,
--  * nobody except a real admin can change dates, amount, car, customer, code or days.
create or replace function public.validate_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare p numeric;
begin
  if new.end_date < new.start_date then raise exception 'วันคืนรถต้องไม่ก่อนวันรับรถ'; end if;
  if tg_op = 'INSERT' then
    if new.start_date < (now() at time zone 'Asia/Bangkok')::date then raise exception 'ไม่สามารถจองย้อนหลังได้'; end if;
    select price_per_day into p from public.cars where id = new.car_id and status <> 'unavailable';
    if p is null then raise exception 'รถคันนี้ไม่พร้อมให้เช่า'; end if;
    if exists (select 1 from public.bookings b where b.car_id = new.car_id
      and (b.status in ('confirmed','active') or (b.status = 'pending' and b.created_at > now() - interval '15 minutes'))
      and daterange(b.start_date, b.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
      raise exception 'รถคันนี้ถูกจองในช่วงวันที่เลือกแล้ว';
    end if;
    new.days := (new.end_date - new.start_date) + 1;
    new.total_amount := p * new.days;
  end if;
  if tg_op = 'UPDATE' and not public.has_role(auth.uid(), 'admin') then
    if new.status <> old.status
       and not public.is_demo_admin(auth.uid())
       and not (old.status in ('pending','confirmed') and new.status = 'cancelled')
       and not (old.status = 'pending' and new.status = 'confirmed'
                and exists (select 1 from public.payments p where p.booking_id = new.id and p.status = 'paid')) then
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
    end if;
    new.total_amount := old.total_amount; new.start_date := old.start_date;
    new.end_date := old.end_date; new.car_id := old.car_id;
    new.user_id := old.user_id; new.booking_code := old.booking_code; new.days := old.days;
  end if;
  return new;
end; $$;

-- Demo Customer accounts (app_metadata.demo or the reserved .invalid email domain) can never
-- hold admin OR demo_admin. Same function and trigger as migration 0003, extended to demo_admin.
create or replace function public.prevent_demo_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role::text in ('admin', 'demo_admin') and exists (
    select 1 from auth.users u where u.id = new.user_id
      and (coalesce(u.raw_app_meta_data->>'demo','false') = 'true' or lower(u.email) like '%@demo.siamwheels.invalid')
  ) then
    raise exception 'Demo accounts cannot be granted admin';
  end if;
  return new;
end; $$;
```

## Step 3 – create the Demo Admin account (owner only, not a Lovable prompt)

1. In Lovable → **Cloud → Users → Add user**: enter the demo email and a strong password,
   and tick auto-confirm. (Don't use the public sign-up form, and never put the password in
   the code or the repo.) The sign-up trigger gives it the `customer` role only.
2. In Lovable → **Cloud → SQL editor**, grant the role. It returns no row if the email is not
   found, not confirmed, or already an admin – nothing is granted in that case:

```sql
insert into public.user_roles(user_id, role)
select u.id, 'demo_admin'::app_role from auth.users u
where lower(u.email) = lower('<DEMO_ADMIN_EMAIL>')
  and u.email_confirmed_at is not null
  and coalesce(u.raw_app_meta_data->>'demo','false') <> 'true'
  and not exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin')
on conflict (user_id, role) do nothing
returning user_id;
```

   Use an ordinary email you control, **not** `@demo.siamwheels.invalid` (that domain is
   reserved for Demo Customer accounts and the trigger rejects it).

3. Share the password with the presenter privately. Change it after client demos.

**To revoke:** `delete from public.user_roles where role = 'demo_admin' and user_id = '<id>';`
(or ban the user in Cloud → Users).

## Check afterwards

```sql
select u.email, r.role from public.user_roles r join auth.users u on u.id = r.user_id
where r.role::text in ('admin', 'demo_admin');                       -- your admin + the demo admin

select tablename, policyname, cmd from pg_policies
where policyname like 'demo admin%' order by 1;                      -- 11 policies, none for DELETE
```

Then sign in on `/auth` → "Demo Admin" and confirm: no delete button on cars, contracts open
read-only, no reviews tab, and booking status / maintenance updates work.
