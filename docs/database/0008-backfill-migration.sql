-- =====================================================================
-- 0008 backfill: SQL applied to production directly, recorded as one migration
--
-- These 9 files from docs/database/ were run on the live database with the query tool
-- (2026-11-14 to 2026-11-15), so they were never Drizzle migrations. This file is their
-- exact text, in the order they were applied, so that a database built from
-- drizzle/migrations/ alone matches production.
--
-- Every file is re-runnable: running this on production changes nothing (checked by
-- src/test/db/migration-backfill.db.test.ts, which compares the full schema fingerprint).
-- =====================================================================

-- >>>>>>>>>>>>>>>>>>>> docs/database/revision-limits.sql

-- =====================================================================
-- Contract revision rules (runs after 0007_booking_fee_flow)
--
-- 1. A customer may ask for changes at most 2 times per contract. Every request renews the
--    car's hold, so without a limit a customer could keep a car held without paying.
-- 2. A customer's requested name is no longer written to their profile when they ask.
--    The admin applies it with admin_apply_requested_name(), which only accepts the exact
--    name in the customer's open request and records it in the contract history.
--
-- No table, policy or data changes. Re-runnable (create or replace).
-- =====================================================================

create or replace function public.max_customer_revisions()
returns int language sql immutable set search_path = public as $$ select 2 $$;

-- 0004's function plus the limit (unchanged otherwise).
create or replace function public.customer_request_revision(_contract_id uuid, _version int, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'กรุณาเข้าสู่ระบบ' using errcode = '42501'; end if;
  if length(btrim(coalesce(_reason, ''))) < 5 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'; end if;
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null or c.user_id <> uid then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'pending_customer' then raise exception 'ขอแก้ไขได้เฉพาะสัญญาที่รอลูกค้าตรวจสอบ'; end if;
  if _version is distinct from c.sent_version then raise exception 'ฉบับสัญญาไม่ใช่ฉบับล่าสุด กรุณาโหลดหน้าใหม่'; end if;
  if (select count(*) from public.contract_events e
      where e.contract_id = c.id and e.action = 'revision_requested' and e.actor_role = 'customer')
     >= public.max_customer_revisions() then
    raise exception 'ขอแก้ไขสัญญาได้สูงสุด % ครั้งต่อการจอง กรุณายืนยันสัญญาหรือยกเลิกการจอง',
      public.max_customer_revisions();
  end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  perform set_config('app.contract_workflow', 'on', true);
  update public.contracts set status = 'revision_requested', revision_reason = btrim(_reason),
    revision_requested_by = 'customer' where id = c.id;
  update public.bookings set hold_expires_at = public.contract_hold_until(b.start_date, interval '24 hours')
    where id = b.id;
  perform public.log_contract_event(c.id, b.id, _version, 'revision_requested', btrim(_reason));
end; $$;

-- The admin applies the name from the customer's open request (contract text uses the profile name).
create or replace function public.admin_apply_requested_name(_contract_id uuid, _name text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; n text := btrim(coalesce(_name, ''));
begin
  perform public.require_admin_permission('contracts_manage');
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'revision_requested' or c.revision_requested_by is distinct from 'customer' then
    raise exception 'สัญญานี้ไม่มีคำขอแก้ไขจากลูกค้า';
  end if;
  if length(n) < 2 or length(n) > 100 then raise exception 'ชื่อลูกค้าไม่ถูกต้อง'; end if;
  if position(('ชื่อลูกค้า: ' || n || E'\n') in (replace(coalesce(c.revision_reason, ''), E'\r', '') || E'\n')) <> 1 then
    raise exception 'ชื่อไม่ตรงกับที่ลูกค้าขอแก้ไข';
  end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  update public.profiles set full_name = n, updated_at = now() where id = c.user_id;
  perform public.log_contract_event(c.id, b.id, c.current_version, 'edited',
    'เปลี่ยนชื่อผู้เช่าตามคำขอของลูกค้า: ' || n);
end; $$;

revoke all on function public.max_customer_revisions() from public, anon;
grant execute on function public.max_customer_revisions() to authenticated;
revoke all on function public.customer_request_revision(uuid, int, text) from public, anon;
grant execute on function public.customer_request_revision(uuid, int, text) to authenticated;
revoke all on function public.admin_apply_requested_name(uuid, text) from public, anon;
grant execute on function public.admin_apply_requested_name(uuid, text) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> docs/database/pickup-day-status.sql

-- =====================================================================
-- Hand-over / return only from the pickup day (runs after 0007 and revision-limits)
--
-- validate_booking() from 0004, unchanged except one rule: a booking can move to "active"
-- (car handed over) or "completed" (car returned) only on or after its pickup day
-- (Bangkok date). Before that an admin can still cancel it. Bookings that already
-- moved early are left as they are (the rule only checks status changes).
-- Re-runnable (create or replace). No table, policy or data changes.
-- =====================================================================

create or replace function public.validate_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p numeric;
  uid uuid := auth.uid();
  can_manage boolean := public.has_admin_permission(auth.uid(), 'bookings_manage');
  in_workflow boolean := coalesce(current_setting('app.contract_workflow', true), '') = 'on';
  manual_confirm boolean := coalesce(current_setting('app.manual_confirm', true), '') = 'on';
  expiring boolean := coalesce(current_setting('app.cancel_reason', true), '') = 'expired';
  move text;
begin
  if new.end_date < new.start_date then raise exception 'วันคืนรถต้องไม่ก่อนวันรับรถ'; end if;

  if tg_op = 'INSERT' then
    if new.start_date < (now() at time zone 'Asia/Bangkok')::date then raise exception 'ไม่สามารถจองย้อนหลังได้'; end if;
    select price_per_day into p from public.cars where id = new.car_id and status <> 'unavailable';
    if p is null then raise exception 'รถคันนี้ไม่พร้อมให้เช่า'; end if;
    if exists (select 1 from public.bookings b where b.car_id = new.car_id
      and public.booking_blocks_car(b.status, b.hold_expires_at)
      and daterange(b.start_date, b.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
      raise exception 'รถคันนี้ถูกจองในช่วงวันที่เลือกแล้ว';
    end if;
    new.days := (new.end_date - new.start_date) + 1;
    new.total_amount := p * new.days;
    -- Stage 1: 24 h for the Admin to prepare and send the contract
    new.hold_expires_at := public.contract_hold_until(new.start_date, interval '24 hours');
    return new;
  end if;

  -- UPDATE by a signed-in user who neither owns the booking nor manages bookings
  if uid is not null and uid is distinct from old.user_id and not can_manage
     and not in_workflow and not manual_confirm and not expiring then
    raise exception 'ไม่มีสิทธิ์แก้ไขการจองนี้' using errcode = '42501';
  end if;

  -- The hold only moves inside the workflow functions
  if not in_workflow then new.hold_expires_at := old.hold_expires_at; end if;

  -- Money, dates and car: never changed by customers; locked for admins once a contract exists
  if not can_manage or exists (select 1 from public.contracts c where c.booking_id = new.id) then
    new.total_amount := old.total_amount; new.start_date := old.start_date;
    new.end_date := old.end_date; new.car_id := old.car_id;
  end if;

  if new.status is distinct from old.status then
    move := old.status::text || '>' || new.status::text;
    if move = 'pending>confirmed' then
      if not (exists (select 1 from public.payments x where x.booking_id = new.id and x.status = 'paid')
              or (manual_confirm and public.is_owner(uid))) then
        raise exception 'ยืนยันการจองได้หลังผู้ดูแลอนุมัติสัญญาและลูกค้าชำระเงินแล้วเท่านั้น';
      end if;
    elsif move in ('pending>cancelled', 'confirmed>cancelled') then
      null; -- the customer, a booking manager, or expiry
    elsif can_manage and move in ('confirmed>active', 'confirmed>completed', 'active>completed', 'active>cancelled') then
      if move in ('confirmed>active', 'confirmed>completed', 'active>completed')
         and (now() at time zone 'Asia/Bangkok')::date < new.start_date then
        raise exception 'ส่งมอบรถหรือรับรถคืนได้ตั้งแต่วันรับรถ (%) เป็นต้นไป', to_char(new.start_date, 'DD/MM/YYYY');
      end if;
      null;
    else
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
    end if;
    if new.status <> 'pending' then new.hold_expires_at := null; end if;
  end if;
  return new;
end; $$;

-- >>>>>>>>>>>>>>>>>>>> docs/database/pickup-payment.sql

-- =====================================================================
-- Pickup payment (runs after 0007_booking_fee_flow)
--
-- After the 1,000 THB booking fee, the customer pays the rest online (DEMO, QR or card),
-- any time before or at pickup: rent + insurance deposit (= rent) - booking fee.
-- The deposit is returned when the car comes back (shown only, not recorded).
-- Adds payments.kind / payments.deposit, one paid payment per kind, and pay_pickup().
-- Re-runnable. pay_booking is unchanged: its payment gets kind 'booking_fee' by default.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Second payment: the rest, paid online before or at pickup.
--    payments.kind: 'booking_fee' (1,000 THB, opens the booking) or 'pickup'
--    (rent + deposit - fee). payments.deposit: the refundable part of a payment
--    (the deposit inside a pickup payment); revenue = amount - deposit.
--    One paid payment of each kind per booking.
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists kind text not null default 'booking_fee';
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('booking_fee','pickup'));
alter table public.payments add column if not exists deposit numeric(10,2) not null default 0;
drop index if exists public.payments_one_paid_per_booking;
create unique index if not exists payments_one_paid_per_booking_kind
  on public.payments (booking_id, kind) where status = 'paid';

create or replace function public.pay_pickup(_booking_id uuid, _method payment_method, _card_last4 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; pid uuid; ref text; due numeric; dep numeric;
begin
  select * into b from public.bookings where id = _booking_id and user_id = auth.uid() for update;
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status not in ('confirmed','active') then
    raise exception 'ชำระยอดวันรับรถได้หลังชำระค่าจองแล้วเท่านั้น';
  end if;
  if not exists (select 1 from public.payments
                 where booking_id = b.id and status = 'paid' and kind = 'booking_fee'
                   and amount = public.booking_fee()) then
    -- also refuses bookings that paid the full rent online before the booking fee existed
    raise exception 'การจองนี้ไม่มียอดวันรับรถให้ชำระออนไลน์';
  end if;
  if exists (select 1 from public.payments
             where booking_id = b.id and status = 'paid' and kind = 'pickup') then
    raise exception 'ชำระยอดวันรับรถแล้ว';
  end if;
  if _method = 'card' and (_card_last4 is null or _card_last4 !~ '^[0-9]{4}$') then
    raise exception 'ข้อมูลบัตรไม่ถูกต้อง';
  end if;
  if _method = 'qr' then _card_last4 := null; end if;

  dep := b.total_amount;                                  -- deposit = rent
  due := greatest(b.total_amount + dep - public.booking_fee(), 0);
  ref := 'DEMO-' || upper(substr(md5(random()::text), 1, 10));
  insert into public.payments (booking_id, user_id, method, amount, status, card_last4, reference, kind, deposit)
  values (b.id, b.user_id, _method, due, 'paid', _card_last4, ref, 'pickup', dep)
  returning id into pid;
  return pid;
end; $$;
revoke all on function public.pay_pickup(uuid, payment_method, text) from public, anon;
grant execute on function public.pay_pickup(uuid, payment_method, text) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> docs/database/pickup-refund.sql

-- =====================================================================
-- Cancelling after the pickup payment (runs after pickup-payment.sql)
--
-- Only the 1,000 THB booking fee is non-refundable. When a booking is cancelled before the
-- car is handed over (from pending or confirmed), the rest paid online (kind 'pickup':
-- rent + deposit - fee) is marked refunded (DEMO: recorded only, no money moves).
-- The booking fee, and full-rent payments from before the booking fee, stay not_refunded
-- as before. Cancelling a rental already in progress (active) refunds nothing automatically.
--
-- cancel_contract_with_booking() from 0004 with those two changes. Re-runnable.
-- No table, policy or data changes.
-- =====================================================================

create or replace function public.cancel_contract_with_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.contracts; paid boolean; refunded boolean := false;
        expired boolean := coalesce(current_setting('app.cancel_reason', true), '') = 'expired';
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    -- The rest paid online is returned when the car was never handed over
    if old.status in ('pending', 'confirmed') then
      update public.payments set refund_status = 'refunded'
        where booking_id = new.id and status = 'paid' and refund_status = 'none' and kind = 'pickup';
      refunded := found;
    end if;
    -- The booking fee is kept (and anything else still marked 'none')
    update public.payments set refund_status = 'not_refunded'
      where booking_id = new.id and status = 'paid' and refund_status = 'none';
    paid := found or refunded;
    select * into c from public.contracts where booking_id = new.id;
    if c.id is not null and c.status <> 'cancelled' then
      perform set_config('app.contract_workflow', 'on', true);
      update public.contracts set status = 'cancelled', cancelled_at = now() where id = c.id;
      perform public.log_contract_event(c.id, new.id, c.current_version,
        case when expired then 'expired' else 'cancelled' end,
        case when refunded then 'ยกเลิกหลังชำระเงิน: ไม่คืนค่าจอง คืนยอดที่ชำระเพิ่ม (ค่าเช่า + เงินประกัน - ค่าจอง) (DEMO)'
             when paid then 'ยกเลิกหลังชำระเงิน: เก็บประวัติการชำระไว้ ยังไม่มีการคืนเงิน (DEMO)' end,
        expired);
    end if;
  end if;
  return null;
end; $$;

-- >>>>>>>>>>>>>>>>>>>> docs/database/pickup-at-handover.sql

-- =====================================================================
-- Pickup payment only after hand-over (runs after pickup-payment.sql and pickup-refund.sql)
--
-- After the 1,000 THB booking fee the customer no longer pays the rest straight away.
-- The admin marks the booking "active" when the customer comes to pick up the car; only then
-- can the customer pay the rest online (rent + deposit - fee).
--
-- pay_pickup() from pickup-payment.sql, unchanged except the status check: 'active' only
-- (was 'confirmed' or 'active'). Re-runnable. No table, policy or data changes.
-- =====================================================================

create or replace function public.pay_pickup(_booking_id uuid, _method payment_method, _card_last4 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; pid uuid; ref text; due numeric; dep numeric;
begin
  select * into b from public.bookings where id = _booking_id and user_id = auth.uid() for update;
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status <> 'active' then
    raise exception 'ชำระยอดวันรับรถได้เมื่อผู้ดูแลยืนยันว่าคุณมารับรถแล้วเท่านั้น';
  end if;
  if not exists (select 1 from public.payments
                 where booking_id = b.id and status = 'paid' and kind = 'booking_fee'
                   and amount = public.booking_fee()) then
    -- also refuses bookings that paid the full rent online before the booking fee existed
    raise exception 'การจองนี้ไม่มียอดวันรับรถให้ชำระออนไลน์';
  end if;
  if exists (select 1 from public.payments
             where booking_id = b.id and status = 'paid' and kind = 'pickup') then
    raise exception 'ชำระยอดวันรับรถแล้ว';
  end if;
  if _method = 'card' and (_card_last4 is null or _card_last4 !~ '^[0-9]{4}$') then
    raise exception 'ข้อมูลบัตรไม่ถูกต้อง';
  end if;
  if _method = 'qr' then _card_last4 := null; end if;

  dep := b.total_amount;                                  -- deposit = rent
  due := greatest(b.total_amount + dep - public.booking_fee(), 0);
  ref := 'DEMO-' || upper(substr(md5(random()::text), 1, 10));
  insert into public.payments (booking_id, user_id, method, amount, status, card_last4, reference, kind, deposit)
  values (b.id, b.user_id, _method, due, 'paid', _card_last4, ref, 'pickup', dep)
  returning id into pid;
  return pid;
end; $$;

-- >>>>>>>>>>>>>>>>>>>> docs/database/input-validation.sql

-- =====================================================================
-- Input validation (runs after 0007_booking_fee_flow + revision-limits.sql)
--
-- B1  cars: price per day must be above 0 (a negative price made negative rent, deposit
--     and pickup payments). Seats, mileage and year get sane bounds too.
-- B2-4 profiles: a customer's own edits must use a valid phone, Thai ID / passport and
--     driver's licence format. Checked only on columns that change, so signup
--     (handle_new_user) and older rows are not affected until someone edits them.
-- B5  customer_request_revision: a request that changes nothing (same name, pickup and
--     return time as the sent version) is rejected before it is counted, so it no longer
--     uses up one of the customer's 2 requests.
--
-- No data changes. Re-runnable. The cars constraints are added NOT VALID and then
-- validated; on 2026-11-15 no live car broke them.
-- =====================================================================

-- ---------------------------------------------------------------- B1 cars
alter table public.cars drop constraint if exists cars_price_positive;
alter table public.cars add constraint cars_price_positive check (price_per_day > 0) not valid;
alter table public.cars validate constraint cars_price_positive;

alter table public.cars drop constraint if exists cars_seats_range;
alter table public.cars add constraint cars_seats_range check (seats between 1 and 15) not valid;
alter table public.cars validate constraint cars_seats_range;

alter table public.cars drop constraint if exists cars_mileage_nonnegative;
alter table public.cars add constraint cars_mileage_nonnegative check (mileage >= 0) not valid;
alter table public.cars validate constraint cars_mileage_nonnegative;

alter table public.cars drop constraint if exists cars_year_range;
alter table public.cars add constraint cars_year_range check (year between 1990 and 2100) not valid;
alter table public.cars validate constraint cars_year_range;

-- ---------------------------------------------------------------- B2-4 profiles
-- Thai national ID: 13 digits, last digit = (11 - sum(d[i] * (13 - i)) mod 11) mod 10.
create or replace function public.is_valid_thai_id(_id text)
returns boolean language sql immutable set search_path = public as $$
  select _id ~ '^[0-9]{13}$' and
    (11 - (select sum(substr(_id, i, 1)::int * (14 - i)) from generate_series(1, 12) i)::int % 11) % 10
      = substr(_id, 13, 1)::int
$$;

create or replace function public.validate_profile_fields()
returns trigger language plpgsql set search_path = public as $$
declare digits text; idn text; lic text;
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    digits := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');
    -- signup (handle_new_user) inserts the phone it was given; only edits are checked
    if tg_op = 'UPDATE' and coalesce(new.phone, '') <> '' and digits !~ '^0[0-9]{8,9}$' then
      raise exception 'เบอร์โทรศัพท์ไม่ถูกต้อง (ตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0)';
    end if;
  end if;
  if tg_op = 'INSERT' or new.id_card_no is distinct from old.id_card_no then
    idn := upper(regexp_replace(coalesce(new.id_card_no, ''), '[\s-]', '', 'g'));
    if idn <> '' and not (public.is_valid_thai_id(idn) or (idn ~ '^[A-Z0-9]{6,9}$' and idn !~ '^[0-9]+$')) then
      raise exception 'เลขบัตรประชาชน (13 หลัก) หรือเลขพาสปอร์ตไม่ถูกต้อง';
    end if;
  end if;
  if tg_op = 'INSERT' or new.license_no is distinct from old.license_no then
    lic := regexp_replace(coalesce(new.license_no, ''), '[\s-]', '', 'g');
    if tg_op = 'UPDATE' and lic = '' then
      raise exception 'กรุณากรอกหมายเลขใบอนุญาตขับขี่';
    end if;
    if lic <> '' and lic !~ '^[A-Za-z0-9]{6,20}$' then
      raise exception 'หมายเลขใบอนุญาตขับขี่ไม่ถูกต้อง (ตัวอักษรหรือตัวเลข 6-20 ตัว)';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists validate_profile_fields on public.profiles;
create trigger validate_profile_fields before insert or update on public.profiles
  for each row execute function public.validate_profile_fields();

-- ---------------------------------------------------------------- B5 revision requests
-- revision-limits.sql's function plus the "nothing changed" check (unchanged otherwise).
-- The reason text is written by revisionReasonText() in src/lib/contract-workflow.ts:
--   ชื่อลูกค้า: <name>\nเวลารับรถ: HH:MM น.\nเวลาคืนรถ: HH:MM น.
-- Free-text reasons (not in that format) are not compared.
create or replace function public.customer_request_revision(_contract_id uuid, _version int, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; v public.contract_versions; uid uuid := auth.uid();
  m text[];
begin
  if uid is null then raise exception 'กรุณาเข้าสู่ระบบ' using errcode = '42501'; end if;
  if length(btrim(coalesce(_reason, ''))) < 5 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'; end if;
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null or c.user_id <> uid then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'pending_customer' then raise exception 'ขอแก้ไขได้เฉพาะสัญญาที่รอลูกค้าตรวจสอบ'; end if;
  if _version is distinct from c.sent_version then raise exception 'ฉบับสัญญาไม่ใช่ฉบับล่าสุด กรุณาโหลดหน้าใหม่'; end if;
  m := regexp_match(replace(_reason, E'\r', ''),
    E'^\\s*ชื่อลูกค้า: (.+)\\nเวลารับรถ: ([0-9]{2}:[0-9]{2}) น\\.\\nเวลาคืนรถ: ([0-9]{2}:[0-9]{2}) น\\.\\s*$');
  if m is not null then
    select * into v from public.contract_versions where contract_id = c.id and version = c.sent_version;
    if v.id is not null
       and btrim(m[1]) = btrim(coalesce(v.customer_name, ''))
       and m[2] = to_char(v.pickup_at at time zone 'Asia/Bangkok', 'HH24:MI')
       and m[3] = to_char(v.return_at at time zone 'Asia/Bangkok', 'HH24:MI') then
      raise exception 'ยังไม่ได้แก้ไขข้อมูลใด กรุณาเปลี่ยนชื่อหรือเวลาที่ต้องการก่อนส่งคำขอ';
    end if;
  end if;
  if (select count(*) from public.contract_events e
      where e.contract_id = c.id and e.action = 'revision_requested' and e.actor_role = 'customer')
     >= public.max_customer_revisions() then
    raise exception 'ขอแก้ไขสัญญาได้สูงสุด % ครั้งต่อการจอง กรุณายืนยันสัญญาหรือยกเลิกการจอง',
      public.max_customer_revisions();
  end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  perform set_config('app.contract_workflow', 'on', true);
  update public.contracts set status = 'revision_requested', revision_reason = btrim(_reason),
    revision_requested_by = 'customer' where id = c.id;
  update public.bookings set hold_expires_at = public.contract_hold_until(b.start_date, interval '24 hours')
    where id = b.id;
  perform public.log_contract_event(c.id, b.id, _version, 'revision_requested', btrim(_reason));
end; $$;

revoke all on function public.is_valid_thai_id(text) from public, anon;
grant execute on function public.is_valid_thai_id(text) to authenticated;
revoke all on function public.customer_request_revision(uuid, int, text) from public, anon;
grant execute on function public.customer_request_revision(uuid, int, text) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> docs/database/booking-documents.sql

-- =====================================================================
-- Booking documents + receipt details (runs after 0007 and the 6 docs/database SQL files)
--
-- 1. validate_booking(): pickup-day-status.sql's function, unchanged except that a new
--    booking is refused unless the customer's profile has an ID card / passport number
--    AND a driver's licence number. Existing bookings are not affected.
-- 2. booking_receipt_details(_booking_id): what the receipt shows. The customer's full
--    profile and email, the contract number, and the name of the admin who created the
--    contract. Customers cannot read admin profiles directly (RLS), so this
--    security definer function returns only that one name, and only to the booking's
--    owner or an admin.
-- Re-runnable (create or replace). No table, policy or data changes.
-- =====================================================================

create or replace function public.validate_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p numeric;
  uid uuid := auth.uid();
  can_manage boolean := public.has_admin_permission(auth.uid(), 'bookings_manage');
  in_workflow boolean := coalesce(current_setting('app.contract_workflow', true), '') = 'on';
  manual_confirm boolean := coalesce(current_setting('app.manual_confirm', true), '') = 'on';
  expiring boolean := coalesce(current_setting('app.cancel_reason', true), '') = 'expired';
  move text;
begin
  if new.end_date < new.start_date then raise exception 'วันคืนรถต้องไม่ก่อนวันรับรถ'; end if;

  if tg_op = 'INSERT' then
    -- Booking needs an ID card / passport number and a driver's licence number in the profile
    if not exists (select 1 from public.profiles pr where pr.id = new.user_id
                   and btrim(coalesce(pr.id_card_no, '')) <> ''
                   and btrim(coalesce(pr.license_no, '')) <> '') then
      raise exception 'กรุณากรอกเลขบัตรประชาชน (หรือพาสปอร์ต) และเลขใบอนุญาตขับขี่ในหน้าโปรไฟล์ก่อนจองรถ';
    end if;
    if new.start_date < (now() at time zone 'Asia/Bangkok')::date then raise exception 'ไม่สามารถจองย้อนหลังได้'; end if;
    select price_per_day into p from public.cars where id = new.car_id and status <> 'unavailable';
    if p is null then raise exception 'รถคันนี้ไม่พร้อมให้เช่า'; end if;
    if exists (select 1 from public.bookings b where b.car_id = new.car_id
      and public.booking_blocks_car(b.status, b.hold_expires_at)
      and daterange(b.start_date, b.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
      raise exception 'รถคันนี้ถูกจองในช่วงวันที่เลือกแล้ว';
    end if;
    new.days := (new.end_date - new.start_date) + 1;
    new.total_amount := p * new.days;
    -- Stage 1: 24 h for the Admin to prepare and send the contract
    new.hold_expires_at := public.contract_hold_until(new.start_date, interval '24 hours');
    return new;
  end if;

  -- UPDATE by a signed-in user who neither owns the booking nor manages bookings
  if uid is not null and uid is distinct from old.user_id and not can_manage
     and not in_workflow and not manual_confirm and not expiring then
    raise exception 'ไม่มีสิทธิ์แก้ไขการจองนี้' using errcode = '42501';
  end if;

  -- The hold only moves inside the workflow functions
  if not in_workflow then new.hold_expires_at := old.hold_expires_at; end if;

  -- Money, dates and car: never changed by customers; locked for admins once a contract exists
  if not can_manage or exists (select 1 from public.contracts c where c.booking_id = new.id) then
    new.total_amount := old.total_amount; new.start_date := old.start_date;
    new.end_date := old.end_date; new.car_id := old.car_id;
  end if;

  if new.status is distinct from old.status then
    move := old.status::text || '>' || new.status::text;
    if move = 'pending>confirmed' then
      if not (exists (select 1 from public.payments x where x.booking_id = new.id and x.status = 'paid')
              or (manual_confirm and public.is_owner(uid))) then
        raise exception 'ยืนยันการจองได้หลังผู้ดูแลอนุมัติสัญญาและลูกค้าชำระเงินแล้วเท่านั้น';
      end if;
    elsif move in ('pending>cancelled', 'confirmed>cancelled') then
      null; -- the customer, a booking manager, or expiry
    elsif can_manage and move in ('confirmed>active', 'confirmed>completed', 'active>completed', 'active>cancelled') then
      if move in ('confirmed>active', 'confirmed>completed', 'active>completed')
         and (now() at time zone 'Asia/Bangkok')::date < new.start_date then
        raise exception 'ส่งมอบรถหรือรับรถคืนได้ตั้งแต่วันรับรถ (%) เป็นต้นไป', to_char(new.start_date, 'DD/MM/YYYY');
      end if;
      null;
    else
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
    end if;
    if new.status <> 'pending' then new.hold_expires_at := null; end if;
  end if;
  return new;
end; $$;


create or replace function public.booking_receipt_details(_booking_id uuid)
returns table (
  customer_name text, customer_email text, customer_phone text, customer_address text,
  customer_id_card_no text, customer_license_no text,
  contract_no text, contract_created_by_name text, contract_created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  b public.bookings%rowtype;
  creator uuid;
begin
  select * into b from public.bookings where id = _booking_id;
  if b.id is null or (b.user_id is distinct from auth.uid() and not public.has_role(auth.uid(), 'admin')) then
    raise exception 'ไม่พบการจองนี้' using errcode = '42501';
  end if;

  select c.contract_no, c.created_at into contract_no, contract_created_at
    from public.contracts c where c.booking_id = b.id;
  -- Who created the contract: the "created" event, else the first version's author
  select e.actor_id into creator from public.contract_events e
    join public.contracts c on c.id = e.contract_id
    where c.booking_id = b.id and e.action = 'created' order by e.created_at limit 1;
  if creator is null then
    select v.created_by into creator from public.contract_versions v
      join public.contracts c on c.id = v.contract_id
      where c.booking_id = b.id order by v.version limit 1;
  end if;
  if creator is not null then
    select coalesce(nullif(btrim(p.full_name), ''), 'ผู้ดูแลระบบ') into contract_created_by_name
      from public.profiles p where p.id = creator;
    contract_created_by_name := coalesce(contract_created_by_name, 'ผู้ดูแลระบบ');
  end if;

  select p.full_name, p.phone, p.address, p.id_card_no, p.license_no
    into customer_name, customer_phone, customer_address, customer_id_card_no, customer_license_no
    from public.profiles p where p.id = b.user_id;
  select u.email into customer_email from auth.users u where u.id = b.user_id;
  return next;
end; $$;

revoke all on function public.booking_receipt_details(uuid) from public, anon;
grant execute on function public.booking_receipt_details(uuid) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> docs/database/drop-reviews.sql

-- =====================================================================
-- Drop the reviews table (runs after 0007 and the other docs/database SQL files)
--
-- The review feature was removed from the app (PR #31). On 2026-11-15 the live table had
-- 0 rows, and no view, trigger, foreign key or function used it. Its three policies
-- ("reviews public", "reviews insert", "reviews delete admin") go with the table.
--
-- Plain DROP (no CASCADE): if anything did depend on the table, this fails instead of
-- silently dropping it too. Re-runnable.
--
-- The reviews_moderate admin permission is removed separately by
-- drop-reviews-permission.sql.
-- =====================================================================

drop table if exists public.reviews;

-- >>>>>>>>>>>>>>>>>>>> docs/database/drop-reviews-permission.sql

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
