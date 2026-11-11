# Phase 4 – Database integration & security: proposed Lovable changes

Status: **PROPOSAL – not applied.** Lovable MCP is not connected, so nothing here has
been run. Apply through the Lovable editor (Cloud → SQL / chat), one step at a time,
after the read-only pre-checks.

All changes are **additive**: no table, column or row is dropped or deleted. Functions
and triggers are replaced with `create or replace`. New constraints are added
`NOT VALID` first so existing rows can never make a migration fail.

Lovable project: `5d1d14e6-eaa0-4fb3-9e01-7ee276fc1f65` · Supabase ref `dhdcpcctdhvqknjdkvwl`
Baseline schema: `drizzle/migrations/0000_migration.sql`, `0001_migration.sql`.

---

## Step 0 – Read-only pre-checks (run first, paste results back)

```sql
-- 0.1 Who is admin today?
select u.email, r.role from public.user_roles r join auth.users u on u.id = r.user_id
where r.role = 'admin';

-- 0.2 Row counts we must preserve
select (select count(*) from public.profiles) profiles,
       (select count(*) from public.bookings) bookings,
       (select count(*) from public.payments) payments,
       (select count(*) from public.cars) cars,
       (select count(*) from public.contracts) contracts,
       (select count(*) from public.maintenance) maintenance;

-- 0.3 Values that new CHECK constraints must accept
select status, count(*) from public.payments group by 1;
select status, count(*) from public.contracts group by 1;
select count(*) bad_last4 from public.payments where card_last4 is not null and card_last4 !~ '^[0-9]{4}$';

-- 0.4 Duplicate paid payments per booking (would block the unique index in 5)
select booking_id, count(*) from public.payments where status = 'paid' group by 1 having count(*) > 1;

-- 0.5 Pending bookings currently holding cars
select status, count(*), min(created_at) from public.bookings group by 1;

-- 0.6 Maintenance rows marked completed without a date
select count(*) from public.maintenance where status = 'completed' and completed_date is null;

-- 0.7 Is pg_cron available?
select extname from pg_extension where extname in ('pg_cron','pg_net');
```

---

## Issues found in the current schema

| # | Area | Problem |
|---|------|---------|
| A | Payment | `pay_booking` sets `pending → confirmed`, but `validate_booking` blocks every non-admin status change except cancel. Since `auth.uid()` is still the customer inside a SECURITY DEFINER function, customer payments **should fail** with "ไม่มีสิทธิ์เปลี่ยนสถานะ". Needs confirming in the live app. |
| B | Integrity | Customers can update their own `contracts` row freely, including `terms`. |
| C | Integrity | Non-admin booking updates lock dates/amount/car but not `days`, `booking_code`, `user_id`. |
| D | Availability | `pending` bookings hold a car forever – no payment deadline. |
| E | Availability | Cars in maintenance can still be booked (only `unavailable` is rejected). |
| F | Admin | `handle_new_user` makes the first sign-up admin whenever no admin exists (e.g. after the last admin is removed, any stranger who signs up becomes admin). |
| G | Maintenance | Car status is set from the browser and only for `in_progress`; nothing resets it on completion; `completed_date` is never filled. |
| H | Payments | `payments.status` is free text, `card_last4` unchecked, double payment not prevented at DB level, no demo flag. |

---

## Step 1 – Security & data integrity  (fixes A, B, C)

**Impact on existing data:** none. Only function/trigger logic changes.

**Prompt for Lovable:**

> Please create a database migration for security and data integrity. Do not drop or
> delete any table, column or row. Use exactly this SQL:

```sql
-- Internal flag so trusted SECURITY DEFINER functions can change booking status.
create or replace function public._allow_status_change() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('app.trusted_status_change', true), '') = 'on'
$$;

create or replace function public.validate_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare p numeric;
begin
  if new.end_date < new.start_date then raise exception 'วันคืนรถต้องไม่ก่อนวันรับรถ'; end if;

  if tg_op = 'INSERT' then
    if new.start_date < (now() at time zone 'Asia/Bangkok')::date then raise exception 'ไม่สามารถจองย้อนหลังได้'; end if;
    select price_per_day into p from public.cars
      where id = new.car_id and status not in ('unavailable');
    if p is null then raise exception 'รถคันนี้ไม่พร้อมให้เช่า'; end if;
    if public.car_is_blocked(new.car_id, new.start_date, new.end_date, null) then
      raise exception 'รถคันนี้ถูกจองหรืออยู่ระหว่างซ่อมบำรุงในช่วงวันที่เลือก';
    end if;
    new.status := 'pending';
    new.days := (new.end_date - new.start_date) + 1;
    new.total_amount := p * new.days;
    new.payment_expires_at := now() + interval '15 minutes';
  end if;

  if tg_op = 'UPDATE' and not public.has_role(auth.uid(),'admin') then
    if new.status <> old.status
       and not public._allow_status_change()
       and not (old.status in ('pending','confirmed') and new.status = 'cancelled') then
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
    end if;
    new.user_id := old.user_id; new.car_id := old.car_id; new.booking_code := old.booking_code;
    new.start_date := old.start_date; new.end_date := old.end_date;
    new.days := old.days; new.total_amount := old.total_amount;
    new.payment_expires_at := old.payment_expires_at; new.created_at := old.created_at;
  end if;
  return new;
end; $$;

-- Customers may only accept their contract (once); admins keep full edit rights.
create or replace function public.guard_contract_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.has_role(auth.uid(),'admin') then return new; end if;
  if old.customer_accepted_at is not null then raise exception 'สัญญานี้ได้รับการยอมรับแล้ว'; end if;
  new.terms := old.terms; new.user_id := old.user_id; new.booking_id := old.booking_id;
  new.contract_no := old.contract_no; new.created_at := old.created_at;
  if new.customer_accepted_at is not null then
    new.customer_accepted_at := now(); new.status := 'accepted';
  else
    new.status := old.status;
  end if;
  return new;
end; $$;
drop trigger if exists trg_guard_contract_update on public.contracts;
create trigger trg_guard_contract_update before update on public.contracts
  for each row execute function public.guard_contract_update();
```

> Note: Step 1 references `car_is_blocked` and `payment_expires_at` from Step 2 —
> **apply Steps 1 and 2 together in one migration** (Step 2 SQL first).

---

## Step 2 – Payment expiration & car availability  (fixes D, E)

**Impact on existing data:** adds nullable column `bookings.payment_expires_at`.
Existing rows get `NULL` = *never auto-expire*, so existing pending bookings behave
exactly as today. (Optional 2b backfill below if you want old pending bookings to
expire – **this changes their status to cancelled; only run if you agree.**)

**Prompt for Lovable:**

> Add a 15-minute payment deadline to bookings and make availability ignore expired
> unpaid bookings and cars under maintenance. Do not delete data. Use this SQL:

```sql
alter table public.bookings add column if not exists payment_expires_at timestamptz;
create index if not exists bookings_car_status_idx on public.bookings (car_id, status);

-- One rule for "this car is not free in this range", used everywhere.
create or replace function public.car_is_blocked(_car uuid, _start date, _end date, _ignore_booking uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bookings b
    where b.car_id = _car and (_ignore_booking is null or b.id <> _ignore_booking)
      and daterange(b.start_date, b.end_date, '[]') && daterange(_start, _end, '[]')
      and (b.status in ('confirmed','active')
           or (b.status = 'pending' and (b.payment_expires_at is null or b.payment_expires_at > now())))
  ) or exists (
    select 1 from public.maintenance m
    where m.car_id = _car and m.status <> 'completed'
      and m.scheduled_date <= _end
      and (m.status = 'in_progress' or m.scheduled_date >= _start)
  ) or exists (select 1 from public.cars c where c.id = _car and c.status = 'unavailable')
$$;

create or replace function public.booked_car_ids(_start date, _end date)
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.cars c where public.car_is_blocked(c.id, _start, _end, null)
$$;
grant execute on function public.booked_car_ids(date, date) to anon, authenticated;

-- Cancels unpaid bookings past their deadline. Safe for anyone to call.
create or replace function public.expire_pending_bookings()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('app.trusted_status_change', 'on', true);
  update public.bookings
     set status = 'cancelled',
         notes = trim(coalesce(notes,'') || ' [ยกเลิกอัตโนมัติ: เกินเวลาชำระเงิน]')
   where status = 'pending' and payment_expires_at is not null and payment_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end; $$;
grant execute on function public.expire_pending_bookings() to anon, authenticated;

-- If pg_cron is available (pre-check 0.7), run it every 5 minutes:
-- select cron.schedule('expire-pending-bookings', '*/5 * * * *', $$select public.expire_pending_bookings()$$);
```

Optional 2b (only with your approval – changes existing rows):
```sql
update public.bookings set payment_expires_at = created_at + interval '15 minutes'
where status = 'pending' and payment_expires_at is null;
```

---

## Step 3 – Admin role initialization & access control  (fixes F)

**Impact on existing data:** none. Existing admins and customer roles are kept.
New sign-ups only ever get `customer`. Admins are granted explicitly.

**Prompt for Lovable:**

> Stop auto-granting admin on sign-up and add admin-only role management that can never
> remove the last admin. Keep all existing user_roles rows. Use this SQL:

```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
          coalesce(new.raw_user_meta_data->>'phone',''))
  on conflict (id) do nothing;
  insert into public.user_roles(user_id, role) values (new.id, 'customer')
  on conflict (user_id, role) do nothing;
  return new;
end; $$;

create or replace function public.set_user_role(_user_id uuid, _role app_role, _grant boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น'; end if;
  if _grant then
    insert into public.user_roles(user_id, role) values (_user_id, _role) on conflict do nothing;
  else
    if _role = 'admin' and (select count(*) from public.user_roles where role = 'admin') <= 1 then
      raise exception 'ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้';
    end if;
    delete from public.user_roles where user_id = _user_id and role = _role;
  end if;
end; $$;
revoke execute on function public.set_user_role(uuid, app_role, boolean) from anon;
grant execute on function public.set_user_role(uuid, app_role, boolean) to authenticated;
```

Bootstrap (only if pre-check 0.1 shows **no** admin; replace the email yourself):
```sql
insert into public.user_roles(user_id, role)
select id, 'admin' from auth.users where email = '<ADMIN EMAIL>'
on conflict (user_id, role) do nothing;
```

---

## Step 4 – Maintenance automation & completion dates  (fixes G)

**Impact on existing data:** adds a `NOT VALID` check (existing rows untouched).
Optional 4b fills `completed_date` for already-completed rows that lack one.
Car statuses are recalculated only when a maintenance row or booking status changes.

**Prompt for Lovable:**

> Automate car status from maintenance and booking state, and fill completion dates.
> Do not delete data. Use this SQL:

```sql
alter table public.maintenance
  add constraint maintenance_completed_after_scheduled
  check (completed_date is null or completed_date >= scheduled_date) not valid;

create or replace function public.sync_car_status(_car uuid)
returns void language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Bangkok')::date; s car_status;
begin
  select status into s from public.cars where id = _car;
  if s is null or s = 'unavailable' then return; end if;   -- manual "unavailable" wins
  update public.cars set status = case
    when exists (select 1 from public.maintenance m where m.car_id = _car
                 and (m.status = 'in_progress' or (m.status = 'scheduled' and m.scheduled_date <= today)))
      then 'maintenance'::car_status
    when exists (select 1 from public.bookings b where b.car_id = _car and b.status = 'active')
      then 'rented'::car_status
    else 'available'::car_status end
  where id = _car;
end; $$;

create or replace function public.maintenance_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' then
    new.completed_date := coalesce(new.completed_date, (now() at time zone 'Asia/Bangkok')::date);
  else
    new.completed_date := null;
  end if;
  return new;
end; $$;
drop trigger if exists trg_maintenance_before_write on public.maintenance;
create trigger trg_maintenance_before_write before insert or update on public.maintenance
  for each row execute function public.maintenance_before_write();

create or replace function public.maintenance_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform public.sync_car_status(old.car_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform public.sync_car_status(new.car_id); end if;
  return null;
end; $$;
drop trigger if exists trg_maintenance_after_write on public.maintenance;
create trigger trg_maintenance_after_write after insert or update or delete on public.maintenance
  for each row execute function public.maintenance_after_write();

create or replace function public.booking_after_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_car_status(new.car_id);
  return null;
end; $$;
drop trigger if exists trg_booking_after_status on public.bookings;
create trigger trg_booking_after_status after update of status on public.bookings
  for each row execute function public.booking_after_status();

-- Daily refresh so scheduled maintenance switches the car on its date.
create or replace function public.refresh_car_statuses()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.cars loop perform public.sync_car_status(r.id); end loop;
end; $$;
grant execute on function public.refresh_car_statuses() to authenticated;
-- With pg_cron: select cron.schedule('refresh-car-statuses', '5 17 * * *', $$select public.refresh_car_statuses()$$); -- 00:05 Bangkok
```

Optional 4b (fills missing dates on existing completed rows – your call):
```sql
update public.maintenance set completed_date = scheduled_date
where status = 'completed' and completed_date is null;
```

---

## Step 5 – Demo payment records & payment status  (fixes H, completes A)

**Impact on existing data:** adds `payments.is_demo` (default `true` – all existing
payments are demo), `payments.failure_reason`, `payments.created_at`. Adds `NOT VALID`
checks. The unique index needs pre-check 0.4 to return **zero rows**; if it doesn't,
tell me and we'll skip it rather than delete anything.

No card number, CVV or expiry is ever sent to or stored in the database – only the last
4 digits. No real payment is processed.

**Prompt for Lovable:**

> Upgrade the DEMO payment records. Never store full card numbers or CVV. Do not delete
> data. Keep the `pay_booking(uuid, payment_method, text)` signature. Use this SQL:

```sql
alter table public.payments add column if not exists is_demo boolean not null default true;
alter table public.payments add column if not exists failure_reason text;
alter table public.payments add column if not exists created_at timestamptz not null default now();

alter table public.payments add constraint payments_status_check
  check (status in ('pending','paid','failed','refunded')) not valid;
alter table public.payments add constraint payments_card_last4_check
  check (card_last4 is null or card_last4 ~ '^[0-9]{4}$') not valid;
create unique index if not exists payments_one_paid_per_booking
  on public.payments (booking_id) where status = 'paid';

create or replace function public.pay_booking(_booking_id uuid, _method payment_method, _card_last4 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; c public.cars; pid uuid;
begin
  select * into b from public.bookings where id = _booking_id and user_id = auth.uid() for update;
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status <> 'pending' then raise exception 'การจองนี้ชำระเงินแล้วหรือถูกยกเลิก'; end if;

  perform set_config('app.trusted_status_change', 'on', true);

  if b.payment_expires_at is not null and b.payment_expires_at <= now() then
    update public.bookings set status = 'cancelled',
      notes = trim(coalesce(notes,'') || ' [ยกเลิกอัตโนมัติ: เกินเวลาชำระเงิน]') where id = b.id;
    return null;  -- client shows "หมดเวลาชำระเงิน"
  end if;

  if _method = 'card' then
    if _card_last4 is null or _card_last4 !~ '^[0-9]{4}$' then raise exception 'ข้อมูลบัตรไม่ถูกต้อง'; end if;
  else
    _card_last4 := null;
  end if;

  -- DEMO decline: a card ending in 0002 is always declined (recorded, booking stays pending).
  if _method = 'card' and _card_last4 = '0002' then
    insert into public.payments(booking_id,user_id,method,amount,status,card_last4,failure_reason,reference)
    values (b.id, b.user_id, _method, b.total_amount, 'failed', _card_last4, 'DEMO: บัตรถูกปฏิเสธ',
            'DEMO-' || upper(substr(md5(random()::text),1,10)))
    returning id into pid;
    return pid;
  end if;

  insert into public.payments(booking_id,user_id,method,amount,status,card_last4,reference)
  values (b.id, b.user_id, _method, b.total_amount, 'paid', _card_last4,
          'DEMO-' || upper(substr(md5(random()::text),1,10)))
  returning id into pid;

  update public.bookings set status = 'confirmed' where id = b.id;

  select * into c from public.cars where id = b.car_id;
  insert into public.contracts(booking_id,user_id,terms) values (b.id, b.user_id,
    'สัญญาเช่ารถยนต์ ' || c.brand || ' ' || c.model || ' ทะเบียน ' || c.plate_no || E'\n' ||
    'ระยะเวลาเช่า: ' || to_char(b.start_date,'DD/MM/YYYY') || ' ถึง ' || to_char(b.end_date,'DD/MM/YYYY') || ' (' || b.days || ' วัน)' || E'\n' ||
    'ค่าเช่ารวม: ' || to_char(b.total_amount,'FM999,999,990.00') || ' บาท' || E'\n\n' ||
    '1. ผู้เช่าต้องมีใบอนุญาตขับขี่ที่ยังไม่หมดอายุ' || E'\n' ||
    '2. ผู้เช่าต้องคืนรถตามวันและเวลาที่กำหนด หากคืนล่าช้าคิดค่าปรับวันละ 1 เท่าของค่าเช่ารายวัน' || E'\n' ||
    '3. ผู้เช่าต้องคืนรถพร้อมน้ำมันในระดับเดียวกับวันรับรถ' || E'\n' ||
    '4. ห้ามนำรถไปใช้ในทางผิดกฎหมาย หรือให้บุคคลอื่นเช่าช่วง' || E'\n' ||
    '5. กรณีเกิดอุบัติเหตุ ผู้เช่าต้องแจ้งบริษัทภายใน 24 ชั่วโมง')
  on conflict (booking_id) do nothing;
  return pid;
end; $$;
grant execute on function public.pay_booking(uuid, payment_method, text) to authenticated;
```

---

## After Lovable applies the changes (app-side work, done in this repo)

1. Pull the new migrations + regenerated `src/integrations/supabase/types.ts`.
2. Booking page: countdown to `payment_expires_at`; handle `null` return (expired) and
   `failed` payment (declined demo card); card form sends only last 4 digits; clear
   card/CVV state after submit; clear "DEMO" labelling on QR and card tabs.
3. Admin: remove browser-side `cars.update({status})` calls in booking/maintenance
   handlers (DB triggers now own it); add "mark completed" action for maintenance;
   use `set_user_role` for role management.
4. Call `expire_pending_bookings()` on car list / booking page load as a fallback when
   pg_cron is unavailable.
5. Tests for each flow + `vitest run` + production build after every step.
