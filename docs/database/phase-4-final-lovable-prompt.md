# Phase 4 – Final Lovable prompt (ready to paste)

Status: **SUPERSEDED – never applied. Do not paste this prompt.** On 2026-11-11 the project
switched to the smaller `prototype-lovable-prompt.md`, applied as migration
`0002_prototype_function_fixes.sql`. Applying this prompt now would overwrite those live
functions. Kept for reference only; the item-by-item outcome (completed, superseded or
postponed) is in `phase-4-lovable-db-changes.md`.

(Originally: supersedes the step-by-step draft in `phase-4-lovable-db-changes.md`.)

Baseline (confirmed 2026-11-11): 8 cars; 0 bookings, payments, contracts, maintenance;
no admin. Payment status in code: `paid`. Contract status in code: `active`, `accepted`.

## What is preserved

- No `DROP TABLE`, `DROP COLUMN`, `DELETE`, `TRUNCATE` or `UPDATE` of existing rows.
- The 8 cars are not modified by the migration. Their status only changes later, when a
  maintenance record or booking status changes (or the daily refresh runs).
- Only additions: 4 columns (all with safe defaults or nullable), 4 check constraints,
  3 indexes, functions, triggers, optional cron jobs.
- `drop trigger if exists` is used only for triggers this migration creates (makes it re-runnable).

## Prompt to paste into Lovable

> Please create ONE database migration for the Siam Wheels prototype. It is DEMO mode only:
> no real payments. Do not drop or delete any table, column or row, and do not modify the
> existing 8 cars. Do not create or assign any admin role. First run these read-only checks and
> show me the results:
> `select extname from pg_extension where extname in ('pg_cron','pg_net');`
> `select plate_no, status from public.cars order by plate_no;`
> Then apply exactly this SQL as a single migration and regenerate the Supabase types:

```sql
-- =====================================================================
-- Siam Wheels – Phase 4 (DEMO prototype). Additive only.
-- Timezone: deadlines are timestamptz (absolute instants, timezone-proof).
-- Calendar dates ("today") use now() at time zone 'Asia/Bangkok' (UTC+7, no DST).
-- pg_cron runs in UTC, so 17:05 UTC = 00:05 Bangkok.
-- =====================================================================

-- 1. Booking payment deadline -----------------------------------------
alter table public.bookings add column if not exists payment_expires_at timestamptz;
create index if not exists bookings_car_status_idx on public.bookings (car_id, status);
create index if not exists bookings_pending_expiry_idx
  on public.bookings (payment_expires_at) where status = 'pending';

-- 2. Internal flag: lets trusted functions change booking status ------
create or replace function public._allow_status_change() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('app.trusted_status_change', true), '') = 'on'
$$;
revoke all on function public._allow_status_change() from public, anon, authenticated;

-- 3. Single availability rule ----------------------------------------
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
revoke all on function public.car_is_blocked(uuid, date, date, uuid) from public, anon, authenticated;

create or replace function public.booked_car_ids(_start date, _end date)
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.cars c where public.car_is_blocked(c.id, _start, _end, null)
$$;
grant execute on function public.booked_car_ids(date, date) to anon, authenticated;

-- 4. Booking validation (replaces existing function; trigger unchanged)
create or replace function public.validate_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare p numeric;
begin
  if new.end_date < new.start_date then raise exception 'วันคืนรถต้องไม่ก่อนวันรับรถ'; end if;

  if tg_op = 'INSERT' then
    if new.start_date < (now() at time zone 'Asia/Bangkok')::date then
      raise exception 'ไม่สามารถจองย้อนหลังได้';
    end if;
    select price_per_day into p from public.cars where id = new.car_id and status <> 'unavailable';
    if p is null then raise exception 'รถคันนี้ไม่พร้อมให้เช่า'; end if;
    if public.car_is_blocked(new.car_id, new.start_date, new.end_date, null) then
      raise exception 'รถคันนี้ถูกจองหรืออยู่ระหว่างซ่อมบำรุงในช่วงวันที่เลือก';
    end if;
    new.status := 'pending';
    new.days := (new.end_date - new.start_date) + 1;
    new.total_amount := p * new.days;
    new.payment_expires_at := now() + interval '15 minutes';
  end if;

  if tg_op = 'UPDATE' and not public.has_role(auth.uid(), 'admin') then
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

-- 5. Expire unpaid bookings after 15 minutes -------------------------
create or replace function public.expire_pending_bookings()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('app.trusted_status_change', 'on', true);
  update public.bookings
     set status = 'cancelled',
         notes = trim(coalesce(notes, '') || ' [ยกเลิกอัตโนมัติ: เกินเวลาชำระเงิน]')
   where status = 'pending' and payment_expires_at is not null and payment_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.expire_pending_bookings() from public;
grant execute on function public.expire_pending_bookings() to anon, authenticated;

-- 6. Contracts: customers may only accept, once ----------------------
alter table public.contracts add constraint contracts_status_check
  check (status in ('active','accepted','cancelled'));

create or replace function public.guard_contract_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.has_role(auth.uid(), 'admin') then return new; end if;
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

-- 7. Admin: no automatic first-user admin ----------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
          coalesce(new.raw_user_meta_data->>'phone', ''))
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
    if _role = 'admin' and not exists (
      select 1 from auth.users where id = _user_id and email_confirmed_at is not null) then
      raise exception 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล';
    end if;
    insert into public.user_roles(user_id, role) values (_user_id, _role)
    on conflict (user_id, role) do nothing;
  else
    if _role = 'admin' and (select count(*) from public.user_roles where role = 'admin') <= 1 then
      raise exception 'ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้';
    end if;
    delete from public.user_roles where user_id = _user_id and role = _role;
  end if;
end; $$;
revoke all on function public.set_user_role(uuid, app_role, boolean) from public, anon;
grant execute on function public.set_user_role(uuid, app_role, boolean) to authenticated;

-- 8. Automatic car status from maintenance + bookings ----------------
create or replace function public.sync_car_status(_car uuid)
returns void language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Bangkok')::date; s car_status;
begin
  select status into s from public.cars where id = _car;
  if s is null or s = 'unavailable' then return; end if;  -- manual "unavailable" wins
  update public.cars set status = case
    when exists (select 1 from public.maintenance m where m.car_id = _car
                 and (m.status = 'in_progress' or (m.status = 'scheduled' and m.scheduled_date <= today)))
      then 'maintenance'::car_status
    when exists (select 1 from public.bookings b where b.car_id = _car and b.status = 'active')
      then 'rented'::car_status
    else 'available'::car_status end
  where id = _car;
end; $$;
revoke all on function public.sync_car_status(uuid) from public, anon, authenticated;

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
  for each row when (old.status is distinct from new.status)
  execute function public.booking_after_status();

create or replace function public.refresh_car_statuses()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
    raise exception 'ต้องเป็นผู้ดูแลระบบเท่านั้น';
  end if;
  for r in select id from public.cars loop perform public.sync_car_status(r.id); end loop;
end; $$;
revoke all on function public.refresh_car_statuses() from public, anon;
grant execute on function public.refresh_car_statuses() to authenticated;

-- 9. DEMO payments ---------------------------------------------------
alter table public.payments add column if not exists is_demo boolean not null default true;
alter table public.payments add column if not exists failure_reason text;
alter table public.payments add column if not exists created_at timestamptz not null default now();

alter table public.payments add constraint payments_demo_only check (is_demo = true);
alter table public.payments add constraint payments_status_check
  check (status in ('pending','paid','failed','refunded'));
alter table public.payments add constraint payments_card_last4_check
  check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');
create unique index if not exists payments_one_paid_per_booking
  on public.payments (booking_id) where status = 'paid';

create or replace function public.pay_booking(_booking_id uuid, _method payment_method, _card_last4 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; c public.cars; pid uuid;
begin
  -- Row lock: two simultaneous payments for one booking run one after the other.
  select * into b from public.bookings where id = _booking_id and user_id = auth.uid() for update;
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status <> 'pending' then raise exception 'การจองนี้ชำระเงินแล้วหรือถูกยกเลิก'; end if;

  perform set_config('app.trusted_status_change', 'on', true);

  if b.payment_expires_at is not null and b.payment_expires_at <= now() then
    update public.bookings set status = 'cancelled',
      notes = trim(coalesce(notes, '') || ' [ยกเลิกอัตโนมัติ: เกินเวลาชำระเงิน]')
    where id = b.id;
    return null;  -- app shows "หมดเวลาชำระเงิน"
  end if;

  if _method = 'card' then
    if _card_last4 is null or _card_last4 !~ '^[0-9]{4}$' then raise exception 'ข้อมูลบัตรไม่ถูกต้อง'; end if;
  else
    _card_last4 := null;
  end if;

  -- DEMO decline: a card ending in 0002 is always declined; booking stays pending.
  if _method = 'card' and _card_last4 = '0002' then
    insert into public.payments(booking_id, user_id, method, amount, status, card_last4, failure_reason, reference)
    values (b.id, b.user_id, _method, b.total_amount, 'failed', _card_last4, 'DEMO: บัตรถูกปฏิเสธ',
            'DEMO-' || upper(substr(md5(random()::text), 1, 10)))
    returning id into pid;
    return pid;
  end if;

  insert into public.payments(booking_id, user_id, method, amount, status, card_last4, reference)
  values (b.id, b.user_id, _method, b.total_amount, 'paid', _card_last4,
          'DEMO-' || upper(substr(md5(random()::text), 1, 10)))
  returning id into pid;

  update public.bookings set status = 'confirmed' where id = b.id;

  select * into c from public.cars where id = b.car_id;
  insert into public.contracts(booking_id, user_id, terms) values (b.id, b.user_id,
    'สัญญาเช่ารถยนต์ ' || c.brand || ' ' || c.model || ' ทะเบียน ' || c.plate_no || E'\n' ||
    'ระยะเวลาเช่า: ' || to_char(b.start_date, 'DD/MM/YYYY') || ' ถึง ' || to_char(b.end_date, 'DD/MM/YYYY') || ' (' || b.days || ' วัน)' || E'\n' ||
    'ค่าเช่ารวม: ' || to_char(b.total_amount, 'FM999,999,990.00') || ' บาท' || E'\n\n' ||
    '1. ผู้เช่าต้องมีใบอนุญาตขับขี่ที่ยังไม่หมดอายุ' || E'\n' ||
    '2. ผู้เช่าต้องคืนรถตามวันและเวลาที่กำหนด หากคืนล่าช้าคิดค่าปรับวันละ 1 เท่าของค่าเช่ารายวัน' || E'\n' ||
    '3. ผู้เช่าต้องคืนรถพร้อมน้ำมันในระดับเดียวกับวันรับรถ' || E'\n' ||
    '4. ห้ามนำรถไปใช้ในทางผิดกฎหมาย หรือให้บุคคลอื่นเช่าช่วง' || E'\n' ||
    '5. กรณีเกิดอุบัติเหตุ ผู้เช่าต้องแจ้งบริษัทภายใน 24 ชั่วโมง')
  on conflict (booking_id) do nothing;
  return pid;
end; $$;
revoke all on function public.pay_booking(uuid, payment_method, text) from public, anon;
grant execute on function public.pay_booking(uuid, payment_method, text) to authenticated;

-- 10. Scheduled jobs (only if pg_cron is installed; never installs it) --
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('siam-expire-pending-bookings', '* * * * *',
                          'select public.expire_pending_bookings()');
    perform cron.schedule('siam-refresh-car-statuses', '5 17 * * *',   -- 00:05 Bangkok
                          'select public.refresh_car_statuses()');
  else
    raise notice 'pg_cron not installed: the app calls expire_pending_bookings() as a fallback';
  end if;
end $cron$;
```

## After the migration – read-only verification (paste results back)

```sql
-- V1 cars preserved: expect 8, statuses identical to the pre-check
select plate_no, status from public.cars order by plate_no;
-- V2 other row counts unchanged
select (select count(*) from public.bookings) bookings, (select count(*) from public.payments) payments,
       (select count(*) from public.contracts) contracts, (select count(*) from public.maintenance) maintenance,
       (select count(*) from public.profiles) profiles, (select count(*) from public.user_roles) user_roles;
-- V3 nobody is admin yet: expect 0
select count(*) from public.user_roles where role = 'admin';
-- V4 sign-up no longer grants admin: expect true
select position('''admin''' in prosrc) = 0 as no_auto_admin from pg_proc where proname = 'handle_new_user';
-- V5 new columns: expect 4 rows
select table_name, column_name from information_schema.columns
 where table_schema = 'public' and table_name in ('bookings','payments')
   and column_name in ('payment_expires_at','is_demo','failure_reason','created_at');
-- V6 constraints (expect 4) and indexes (expect 3)
select conname from pg_constraint
 where conname in ('contracts_status_check','payments_demo_only','payments_status_check','payments_card_last4_check');
select indexname from pg_indexes
 where indexname in ('bookings_car_status_idx','bookings_pending_expiry_idx','payments_one_paid_per_booking');
-- V7 triggers: expect 6
select tgname from pg_trigger
 where tgname in ('trg_validate_booking','trg_guard_contract_update','trg_maintenance_before_write',
                  'trg_maintenance_after_write','trg_booking_after_status','on_auth_user_created');
-- V8 RLS still enabled on every table: expect all true
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
   and relname in ('profiles','user_roles','cars','bookings','payments','contracts','reviews','maintenance');
-- V9 scheduled jobs (only if pg_cron exists): expect 2
select jobname, schedule from cron.job where jobname like 'siam-%';
```

## Admin account (separate, later – NOT part of the migration)

1. Sign up in the app with the dedicated admin email and verify the email.
2. Run this in Lovable's SQL editor (replace the email). It returns **no row** if the
   account doesn't exist or isn't email-verified, and nothing is granted:

```sql
insert into public.user_roles(user_id, role)
select id, 'admin'::app_role from auth.users
where lower(email) = lower('<ADMIN_EMAIL>') and email_confirmed_at is not null
on conflict (user_id, role) do nothing
returning user_id;
```
