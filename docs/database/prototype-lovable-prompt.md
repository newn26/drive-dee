# Prototype database fix – concise Lovable prompt

Status: **NOT APPLIED.** Replaces the larger Phase 4 plan (`phase-4-*.md`), which is
shelved because this is a client-demo prototype.

What it changes: function bodies only. No new tables, columns, indexes, policies or cron jobs.
No rows are touched; the 8 cars are kept.

## Prompt to paste into Lovable

> Please apply this small database migration for the Siam Wheels demo prototype. Only replace
> these four functions; do not change tables, columns, policies or any data. Payments are a
> DEMO only. Use exactly this SQL:

```sql
-- 1. Bookings: let the demo payment confirm a booking; unpaid bookings stop holding the car
--    after 15 minutes. (Today pay_booking always fails: this trigger blocks pending -> confirmed.)
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
       and not (old.status in ('pending','confirmed') and new.status = 'cancelled')
       and not (old.status = 'pending' and new.status = 'confirmed'
                and exists (select 1 from public.payments p where p.booking_id = new.id and p.status = 'paid')) then
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
    end if;
    new.total_amount := old.total_amount; new.start_date := old.start_date;
    new.end_date := old.end_date; new.car_id := old.car_id;
  end if;
  return new;
end; $$;

-- 2. Availability list uses the same 15-minute rule.
create or replace function public.booked_car_ids(_start date, _end date)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct car_id from public.bookings
  where (status in ('confirmed','active') or (status = 'pending' and created_at > now() - interval '15 minutes'))
    and daterange(start_date, end_date, '[]') && daterange(_start, _end, '[]')
$$;

-- 3. DEMO payment: locks the booking (no double payment), rejects expired bookings,
--    stores only the last 4 card digits. No real payment is processed.
create or replace function public.pay_booking(_booking_id uuid, _method payment_method, _card_last4 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; c public.cars; pid uuid;
begin
  select * into b from public.bookings where id = _booking_id and user_id = auth.uid() for update;
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status <> 'pending' then raise exception 'การจองนี้ชำระเงินแล้วหรือถูกยกเลิก'; end if;
  if b.created_at <= now() - interval '15 minutes' then raise exception 'หมดเวลาชำระเงิน กรุณาจองใหม่อีกครั้ง'; end if;
  if _method = 'card' and (_card_last4 is null or _card_last4 !~ '^[0-9]{4}$') then raise exception 'ข้อมูลบัตรไม่ถูกต้อง'; end if;
  if _method = 'qr' then _card_last4 := null; end if;

  insert into public.payments(booking_id, user_id, method, amount, status, card_last4, reference)
  values (b.id, b.user_id, _method, b.total_amount, 'paid', _card_last4, 'DEMO-' || upper(substr(md5(random()::text), 1, 10)))
  returning id into pid;
  update public.bookings set status = 'confirmed' where id = b.id;

  select * into c from public.cars where id = b.car_id;
  insert into public.contracts(booking_id, user_id, terms) values (b.id, b.user_id,
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

-- 4. Sign-up: every new user is a customer. No automatic first-user admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
          coalesce(new.raw_user_meta_data->>'phone', ''))
  on conflict (id) do nothing;
  insert into public.user_roles(user_id, role) values (new.id, 'customer') on conflict (user_id, role) do nothing;
  return new;
end; $$;
```

## Admin account (after the migration)

Sign up in the app with the admin email, verify it, then run in Lovable's SQL editor
(returns no row = not found or not verified, nothing granted):

```sql
insert into public.user_roles(user_id, role)
select id, 'admin'::app_role from auth.users
where lower(email) = lower('<ADMIN_EMAIL>') and email_confirmed_at is not null
on conflict (user_id, role) do nothing
returning user_id;
```

## Check afterwards

```sql
select count(*) from public.cars;                                  -- 8
select count(*) from public.user_roles where role = 'admin';       -- 0 before the grant, 1 after
```
