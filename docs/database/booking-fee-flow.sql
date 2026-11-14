-- =====================================================================
-- Booking fee flow (runs after 0004_contract_approval_workflow.sql and 0005)
--
-- Business rule (owner's decision, 2026-11-14):
--   1. The customer books a car. The car is held while the admin prepares the contract
--      (24 h, never past midnight after the pickup date; unchanged from 0004).
--   2. The admin creates the draft contract from the booking and sends it (unchanged).
--   3. The customer asks for changes (the admin sends a new version) or confirms it.
--      Confirming no longer waits for admin approval: it opens payment straight away.
--   4. The customer pays a fixed booking fee of 1,000 THB (DEMO, QR or card) within 15 minutes.
--   5. At pickup the customer pays rent + insurance deposit (= rent) - booking fee; the
--      deposit is returned when the car comes back. Neither is recorded in the system.
--   6. The booking fee is not refunded on cancellation (refund_status = 'not_refunded').
--
-- bookings.total_amount stays the rent (price_per_day * days); payments.amount is the fee.
-- admin_approve_contract / admin_request_revision stay for contracts already waiting in
-- 'pending_admin_review' under 0004; no new contract reaches that status.
-- Idempotent: every statement is create-or-replace.
-- =====================================================================

create or replace function public.booking_fee()
returns numeric language sql immutable set search_path = public as $$ select 1000::numeric $$;

-- 1. Contract text: booking fee, amount due at pickup, deposit returned on return.
create or replace function public.render_contract_terms(
  _contract_no text, _version int, _customer_name text, _customer_phone text, _customer_license_no text,
  _car_label text, _car_plate_no text, _pickup_location text, _pickup_at timestamptz, _return_at timestamptz,
  _rental_days int, _rental_price numeric, _deposit numeric, _mileage_allowance text, _late_penalty text,
  _additional_conditions text)
returns text language sql stable set search_path = public as $$
  select concat_ws(E'\n',
    'สัญญาเช่ารถยนต์ เลขที่ ' || _contract_no || ' (ฉบับที่ ' || _version || ')',
    'ผู้เช่า: ' || _customer_name || coalesce(' โทร ' || nullif(_customer_phone, ''), ''),
    case when _customer_license_no is not null then 'เลขที่ใบอนุญาตขับขี่: ' || _customer_license_no end,
    'รถยนต์: ' || _car_label || ' ทะเบียน ' || _car_plate_no,
    'สถานที่รับรถ: ' || _pickup_location,
    'รับรถ: ' || to_char(_pickup_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') || ' น.',
    'คืนรถ: ' || to_char(_return_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') || ' น. (' || _rental_days || ' วัน)',
    'ค่าเช่ารวม: ' || to_char(_rental_price, 'FM999,999,990.00') || ' บาท',
    'เงินประกันความเสียหาย: ' || to_char(_deposit, 'FM999,999,990.00') || ' บาท (เท่ากับค่าเช่า ได้รับคืนเมื่อนำรถมาคืนตามสภาพเดิม)',
    'ค่าจอง (ชำระออนไลน์หลังยืนยันสัญญา): ' || to_char(public.booking_fee(), 'FM999,999,990.00') || ' บาท (ไม่คืนเมื่อยกเลิกการจอง)',
    'ยอดชำระ ณ วันรับรถ (ค่าเช่า + เงินประกัน - ค่าจอง): '
      || to_char(greatest(_rental_price + _deposit - public.booking_fee(), 0), 'FM999,999,990.00') || ' บาท',
    'ข้อกำหนดระยะทาง: ' || _mileage_allowance,
    'ค่าปรับส่งคืนรถล่าช้า: ' || _late_penalty,
    '',
    '1. ผู้เช่าต้องมีใบอนุญาตขับขี่ที่ยังไม่หมดอายุ',
    '2. ผู้เช่าต้องคืนรถตามวันและเวลาที่กำหนด หากคืนล่าช้าจะคิดค่าปรับตามที่ระบุข้างต้น',
    '3. ผู้เช่าต้องคืนรถพร้อมน้ำมันในระดับเดียวกับวันรับรถ',
    '4. ห้ามนำรถไปใช้ในทางผิดกฎหมาย หรือให้บุคคลอื่นเช่าช่วง',
    '5. กรณีเกิดอุบัติเหตุ ผู้เช่าต้องแจ้งบริษัทภายใน 24 ชั่วโมง',
    case when btrim(coalesce(_additional_conditions, '')) <> ''
         then E'\nเงื่อนไขเพิ่มเติม:\n' || btrim(_additional_conditions) end)
$$;

-- 2. Insurance deposit always equals the rent (the admin's deposit value is ignored).
create or replace function public.write_contract_version(
  _contract public.contracts, _b public.bookings, _version int, _is_new boolean,
  _pickup_at timestamptz, _return_at timestamptz, _deposit numeric,
  _mileage_allowance text, _late_penalty text, _additional_conditions text, _include_license boolean)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.profiles; car public.cars; lic text; t text; label text;
begin
  _deposit := _b.total_amount;
  if _pickup_at is null or _return_at is null then raise exception 'กรุณาระบุวันและเวลารับ-คืนรถ'; end if;
  if (_pickup_at at time zone 'Asia/Bangkok')::date <> _b.start_date then
    raise exception 'วันรับรถต้องตรงกับวันที่จอง (%)', to_char(_b.start_date, 'DD/MM/YYYY');
  end if;
  if (_return_at at time zone 'Asia/Bangkok')::date <> _b.end_date then
    raise exception 'วันคืนรถต้องตรงกับวันที่จอง (%)', to_char(_b.end_date, 'DD/MM/YYYY');
  end if;
  if _return_at <= _pickup_at then raise exception 'เวลาคืนรถต้องหลังเวลารับรถ'; end if;
  if btrim(coalesce(_mileage_allowance, '')) = '' then raise exception 'กรุณาระบุข้อกำหนดระยะทาง'; end if;
  if btrim(coalesce(_late_penalty, '')) = '' then raise exception 'กรุณาระบุค่าปรับส่งคืนล่าช้า'; end if;

  select * into pr from public.profiles where id = _b.user_id;
  if btrim(coalesce(pr.full_name, '')) = '' then raise exception 'โปรไฟล์ลูกค้ายังไม่มีชื่อ-นามสกุล'; end if;
  lic := case when _include_license then nullif(btrim(coalesce(pr.license_no, '')), '') end;
  if _include_license and lic is null then raise exception 'ลูกค้ายังไม่ได้กรอกเลขใบอนุญาตขับขี่'; end if;
  select * into car from public.cars where id = _b.car_id;
  label := car.brand || ' ' || car.model || ' (' || car.year || ')';

  t := public.render_contract_terms(_contract.contract_no, _version, btrim(pr.full_name),
         btrim(coalesce(pr.phone, '')), lic, label, car.plate_no, _b.pickup_location, _pickup_at, _return_at,
         _b.days, _b.total_amount, _deposit, btrim(_mileage_allowance), btrim(_late_penalty),
         coalesce(_additional_conditions, ''));

  if _is_new then
    insert into public.contract_versions (contract_id, version, customer_name, customer_phone,
      customer_license_no, car_label, car_plate_no, pickup_location, pickup_at, return_at, rental_days,
      rental_price, deposit, mileage_allowance, late_penalty, additional_conditions, terms, created_by)
    values (_contract.id, _version, btrim(pr.full_name), btrim(coalesce(pr.phone, '')), lic,
      label, car.plate_no, _b.pickup_location, _pickup_at, _return_at, _b.days, _b.total_amount,
      _deposit, btrim(_mileage_allowance), btrim(_late_penalty), coalesce(_additional_conditions, ''),
      t, auth.uid());
  else
    update public.contract_versions set
      customer_name = btrim(pr.full_name), customer_phone = btrim(coalesce(pr.phone, '')),
      customer_license_no = lic, car_label = label, car_plate_no = car.plate_no,
      pickup_location = _b.pickup_location, pickup_at = _pickup_at, return_at = _return_at,
      rental_days = _b.days, rental_price = _b.total_amount, deposit = _deposit,
      mileage_allowance = btrim(_mileage_allowance), late_penalty = btrim(_late_penalty),
      additional_conditions = coalesce(_additional_conditions, ''), terms = t
    where contract_id = _contract.id and version = _version and sent_at is null;
    if not found then raise exception 'ฉบับร่างนี้ถูกส่งให้ลูกค้าแล้ว กรุณาสร้างฉบับใหม่'; end if;
  end if;
end; $$;

-- 3. Contract guard: the customer's confirmation moves pending_customer straight to approved.
create or replace function public.guard_contract_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.contract_workflow', true), '') <> 'on' then
    raise exception 'สัญญาเช่าเปลี่ยนได้ผ่านขั้นตอนของระบบเท่านั้น' using errcode = '42501';
  end if;
  if new.id <> old.id or new.contract_no <> old.contract_no or new.booking_id <> old.booking_id
     or new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'ไม่สามารถเปลี่ยนข้อมูลอ้างอิงของสัญญา';
  end if;
  if old.status in ('paid','cancelled') and new.terms is distinct from old.terms then
    raise exception 'สัญญาที่ชำระเงินหรือยกเลิกแล้วแก้ไขข้อความไม่ได้';
  end if;
  if new.status is distinct from old.status and not ((old.status || '>' || new.status) = any (array[
      'draft>pending_customer', 'draft>cancelled',
      'pending_customer>approved', 'pending_customer>pending_admin_review',
      'pending_customer>revision_requested', 'pending_customer>draft', 'pending_customer>cancelled',
      'pending_admin_review>approved', 'pending_admin_review>revision_requested',
      'pending_admin_review>draft', 'pending_admin_review>cancelled',
      'revision_requested>draft', 'revision_requested>cancelled',
      'approved>paid', 'approved>draft', 'approved>cancelled',
      'paid>cancelled'])) then
    raise exception 'เปลี่ยนสถานะสัญญาจาก % เป็น % ไม่ได้', old.status, new.status;
  end if;
  new.updated_at := now();
  return new;
end; $$;

-- 4. The customer confirms the version they were sent: payment opens for 15 minutes.
create or replace function public.customer_accept_contract(_contract_id uuid, _version int)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'กรุณาเข้าสู่ระบบ' using errcode = '42501'; end if;
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null or c.user_id <> uid then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'pending_customer' then raise exception 'สัญญานี้ไม่อยู่ในสถานะรอลูกค้ายืนยัน'; end if;
  if _version is distinct from c.current_version or _version is distinct from c.sent_version then
    raise exception 'ฉบับสัญญาที่ยืนยันไม่ใช่ฉบับล่าสุด กรุณาโหลดหน้าใหม่';
  end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  perform set_config('app.contract_workflow', 'on', true);
  update public.contract_versions set accepted_at = now(), accepted_by = uid
    where contract_id = c.id and version = _version and sent_at is not null
      and superseded_at is null and accepted_at is null;
  if not found then raise exception 'ไม่สามารถยืนยันสัญญาฉบับนี้ได้'; end if;
  update public.contracts set status = 'approved', customer_accepted_at = now() where id = c.id;
  -- Payment window: 15 minutes from the customer's confirmation
  update public.bookings set hold_expires_at = now() + interval '15 minutes' where id = b.id;
  perform public.log_contract_event(c.id, b.id, _version, 'accepted', null);
end; $$;

-- 5. DEMO payment of the booking fee for a contract the customer confirmed.
create or replace function public.pay_booking(_booking_id uuid, _method payment_method, _card_last4 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; c public.contracts; v public.contract_versions; pid uuid; ref text;
        fee numeric := public.booking_fee();
begin
  select * into b from public.bookings where id = _booking_id and user_id = auth.uid() for update;
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status <> 'pending' then raise exception 'การจองนี้ชำระเงินแล้วหรือถูกยกเลิก'; end if;
  if b.hold_expires_at is null or b.hold_expires_at <= now() then
    raise exception 'หมดเวลาชำระเงิน กรุณาจองใหม่อีกครั้ง';
  end if;
  select * into c from public.contracts where booking_id = b.id for update;
  if c.id is null or c.status <> 'approved' then
    raise exception 'ยังชำระเงินไม่ได้ กรุณายืนยันสัญญาก่อน';
  end if;
  select * into v from public.contract_versions where contract_id = c.id and version = c.current_version;
  if v.id is null or v.sent_at is null or v.accepted_at is null
     or v.superseded_at is not null or v.accepted_by is distinct from b.user_id then
    raise exception 'สัญญาฉบับปัจจุบันยังไม่ได้รับการยืนยันจากลูกค้า';
  end if;
  if exists (select 1 from public.payments where booking_id = b.id and status = 'paid') then
    raise exception 'การจองนี้ชำระเงินแล้ว';
  end if;
  if _method = 'card' and (_card_last4 is null or _card_last4 !~ '^[0-9]{4}$') then
    raise exception 'ข้อมูลบัตรไม่ถูกต้อง';
  end if;
  if _method = 'qr' then _card_last4 := null; end if;

  ref := 'DEMO-' || upper(substr(md5(random()::text), 1, 10));
  insert into public.payments (booking_id, user_id, method, amount, status, card_last4, reference)
  values (b.id, b.user_id, _method, fee, 'paid', _card_last4, ref)
  returning id into pid;
  update public.bookings set status = 'confirmed' where id = b.id;
  perform set_config('app.contract_workflow', 'on', true);
  update public.contracts set status = 'paid', paid_at = now() where id = c.id;
  perform public.log_contract_event(c.id, b.id, c.current_version, 'paid',
    'DEMO ' || _method || ' ค่าจอง ' || to_char(fee, 'FM999,999,990') || ' บาท อ้างอิง ' || ref);
  return pid;
end; $$;

-- ---------------------------------------------------------------------
-- 6. Undo 0005's self-service contract: a booking must wait for the admin again.
--    0005 created and sent a contract on every new booking (no admin step) and let the
--    customer create one for an older booking. Contracts already created stay as they are.
-- ---------------------------------------------------------------------
drop trigger if exists trg_create_contract_on_booking on public.bookings;
do $$
begin
  if to_regprocedure('public.customer_prepare_contract(uuid)') is not null then
    revoke all on function public.customer_prepare_contract(uuid) from public, anon, authenticated;
  end if;
end $$;

revoke all on function public.booking_fee() from public, anon;
grant execute on function public.booking_fee() to authenticated;
revoke all on function public.render_contract_terms(text, int, text, text, text, text, text, text, timestamptz, timestamptz, int, numeric, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.write_contract_version(public.contracts, public.bookings, int, boolean, timestamptz, timestamptz, numeric, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.guard_contract_update() from public, anon, authenticated;
revoke all on function public.customer_accept_contract(uuid, int) from public, anon;
grant execute on function public.customer_accept_contract(uuid, int) to authenticated;
revoke all on function public.pay_booking(uuid, payment_method, text) from public, anon;
grant execute on function public.pay_booking(uuid, payment_method, text) to authenticated;
