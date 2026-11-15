-- =====================================================================
-- Drive Dee – full customer details and creator on contracts; licence required (DEMO prototype)
-- Proposed migration 0005, to be applied by Lovable AFTER 0004_contract_approval_workflow.sql.
--
-- What it does:
--   * contract_versions gets 4 nullable snapshot columns: customer_email, customer_address,
--     customer_id_card_no, created_by_name (the admin who created that version).
--   * Every new or rewritten contract version always carries the customer's driving licence.
--     The _include_license argument is kept (old callers keep working) but ignored.
--   * The contract text also prints email, address, ID card / passport and "ผู้จัดทำสัญญา".
--   * These new columns are frozen once a version is sent, like the existing ones.
--   * A booking is refused when the customer's profile has no driving licence number.
--
-- Additive only: no table, column or row is dropped, deleted or updated. Existing versions keep
-- NULL in the new columns. Rollback: contract-customer-details-rollback.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. New snapshot columns
-- ---------------------------------------------------------------------
alter table public.contract_versions
  add column if not exists customer_email text,
  add column if not exists customer_address text,
  add column if not exists customer_id_card_no text,
  add column if not exists created_by_name text;

-- ---------------------------------------------------------------------
-- 2. Contract text (new overload; the 0004 16-argument version is left in place, unused)
-- ---------------------------------------------------------------------
create or replace function public.render_contract_terms(
  _contract_no text, _version int, _customer_name text, _customer_phone text, _customer_license_no text,
  _car_label text, _car_plate_no text, _pickup_location text, _pickup_at timestamptz, _return_at timestamptz,
  _rental_days int, _rental_price numeric, _deposit numeric, _mileage_allowance text, _late_penalty text,
  _additional_conditions text,
  _customer_email text, _customer_address text, _customer_id_card_no text, _created_by_name text)
returns text language sql stable set search_path = public as $$
  select concat_ws(E'\n',
    'สัญญาเช่ารถยนต์ เลขที่ ' || _contract_no || ' (ฉบับที่ ' || _version || ')',
    'ผู้เช่า: ' || _customer_name || coalesce(' โทร ' || nullif(_customer_phone, ''), ''),
    'อีเมล: ' || nullif(_customer_email, ''),
    'ที่อยู่: ' || nullif(_customer_address, ''),
    'เลขบัตรประชาชน/พาสปอร์ต: ' || nullif(_customer_id_card_no, ''),
    case when _customer_license_no is not null then 'เลขที่ใบอนุญาตขับขี่: ' || _customer_license_no end,
    'รถยนต์: ' || _car_label || ' ทะเบียน ' || _car_plate_no,
    'สถานที่รับรถ: ' || _pickup_location,
    'รับรถ: ' || to_char(_pickup_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') || ' น.',
    'คืนรถ: ' || to_char(_return_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') || ' น. (' || _rental_days || ' วัน)',
    'ค่าเช่ารวม: ' || to_char(_rental_price, 'FM999,999,990.00') || ' บาท',
    'เงินประกันความเสียหาย: ' || to_char(_deposit, 'FM999,999,990.00') || ' บาท (ชำระ ณ วันรับรถ ไม่รวมในการชำระเงินออนไลน์)',
    'ข้อกำหนดระยะทาง: ' || _mileage_allowance,
    'ค่าปรับส่งคืนรถล่าช้า: ' || _late_penalty,
    'ผู้จัดทำสัญญา: ' || nullif(_created_by_name, ''),
    '',
    '1. ผู้เช่าต้องมีใบอนุญาตขับขี่ที่ยังไม่หมดอายุ',
    '2. ผู้เช่าต้องคืนรถตามวันและเวลาที่กำหนด หากคืนล่าช้าจะคิดค่าปรับตามที่ระบุข้างต้น',
    '3. ผู้เช่าต้องคืนรถพร้อมน้ำมันในระดับเดียวกับวันรับรถ',
    '4. ห้ามนำรถไปใช้ในทางผิดกฎหมาย หรือให้บุคคลอื่นเช่าช่วง',
    '5. กรณีเกิดอุบัติเหตุ ผู้เช่าต้องแจ้งบริษัทภายใน 24 ชั่วโมง',
    case when btrim(coalesce(_additional_conditions, '')) <> ''
         then E'\nเงื่อนไขเพิ่มเติม:\n' || btrim(_additional_conditions) end)
$$;

-- ---------------------------------------------------------------------
-- 3. Writing a version: licence always required, new snapshot fields, creator name
-- ---------------------------------------------------------------------
-- Same signature as 0004. _include_license is ignored: the licence is always included.
-- The creator (created_by / created_by_name) is set when a version is created and is not
-- changed by an in-place edit of an unsent draft.
create or replace function public.write_contract_version(
  _contract public.contracts, _b public.bookings, _version int, _is_new boolean,
  _pickup_at timestamptz, _return_at timestamptz, _deposit numeric,
  _mileage_allowance text, _late_penalty text, _additional_conditions text, _include_license boolean)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.profiles; car public.cars; lic text; t text; label text;
  em text; addr text; idc text; creator text;
begin
  if _pickup_at is null or _return_at is null then raise exception 'กรุณาระบุวันและเวลารับ-คืนรถ'; end if;
  if (_pickup_at at time zone 'Asia/Bangkok')::date <> _b.start_date then
    raise exception 'วันรับรถต้องตรงกับวันที่จอง (%)', to_char(_b.start_date, 'DD/MM/YYYY');
  end if;
  if (_return_at at time zone 'Asia/Bangkok')::date <> _b.end_date then
    raise exception 'วันคืนรถต้องตรงกับวันที่จอง (%)', to_char(_b.end_date, 'DD/MM/YYYY');
  end if;
  if _return_at <= _pickup_at then raise exception 'เวลาคืนรถต้องหลังเวลารับรถ'; end if;
  if _deposit is null or _deposit < 0 then raise exception 'เงินประกันต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'; end if;
  if btrim(coalesce(_mileage_allowance, '')) = '' then raise exception 'กรุณาระบุข้อกำหนดระยะทาง'; end if;
  if btrim(coalesce(_late_penalty, '')) = '' then raise exception 'กรุณาระบุค่าปรับส่งคืนล่าช้า'; end if;

  select * into pr from public.profiles where id = _b.user_id;
  if btrim(coalesce(pr.full_name, '')) = '' then raise exception 'โปรไฟล์ลูกค้ายังไม่มีชื่อ-นามสกุล'; end if;
  lic := nullif(btrim(coalesce(pr.license_no, '')), '');
  if lic is null then raise exception 'ลูกค้ายังไม่ได้กรอกเลขใบอนุญาตขับขี่'; end if;
  select nullif(btrim(coalesce(u.email, '')), '') into em from auth.users u where u.id = _b.user_id;
  addr := nullif(btrim(coalesce(pr.address, '')), '');
  idc := nullif(btrim(coalesce(pr.id_card_no, '')), '');

  if _is_new then
    select coalesce(
             (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = auth.uid()),
             (select nullif(btrim(m.email), '') from public.admin_members m where m.user_id = auth.uid()),
             'ผู้ดูแลระบบ')
      into creator;
  else
    select v.created_by_name into creator from public.contract_versions v
      where v.contract_id = _contract.id and v.version = _version;
  end if;

  select * into car from public.cars where id = _b.car_id;
  label := car.brand || ' ' || car.model || ' (' || car.year || ')';

  t := public.render_contract_terms(_contract.contract_no, _version, btrim(pr.full_name),
         btrim(coalesce(pr.phone, '')), lic, label, car.plate_no, _b.pickup_location, _pickup_at, _return_at,
         _b.days, _b.total_amount, _deposit, btrim(_mileage_allowance), btrim(_late_penalty),
         coalesce(_additional_conditions, ''), em, addr, idc, creator);

  if _is_new then
    insert into public.contract_versions (contract_id, version, customer_name, customer_phone,
      customer_license_no, customer_email, customer_address, customer_id_card_no, car_label, car_plate_no,
      pickup_location, pickup_at, return_at, rental_days, rental_price, deposit, mileage_allowance,
      late_penalty, additional_conditions, terms, created_by, created_by_name)
    values (_contract.id, _version, btrim(pr.full_name), btrim(coalesce(pr.phone, '')), lic, em, addr, idc,
      label, car.plate_no, _b.pickup_location, _pickup_at, _return_at, _b.days, _b.total_amount,
      _deposit, btrim(_mileage_allowance), btrim(_late_penalty), coalesce(_additional_conditions, ''),
      t, auth.uid(), creator);
  else
    update public.contract_versions set
      customer_name = btrim(pr.full_name), customer_phone = btrim(coalesce(pr.phone, '')),
      customer_license_no = lic, customer_email = em, customer_address = addr, customer_id_card_no = idc,
      car_label = label, car_plate_no = car.plate_no,
      pickup_location = _b.pickup_location, pickup_at = _pickup_at, return_at = _return_at,
      rental_days = _b.days, rental_price = _b.total_amount, deposit = _deposit,
      mileage_allowance = btrim(_mileage_allowance), late_penalty = btrim(_late_penalty),
      additional_conditions = coalesce(_additional_conditions, ''), terms = t
    where contract_id = _contract.id and version = _version and sent_at is null;
    if not found then raise exception 'ฉบับร่างนี้ถูกส่งให้ลูกค้าแล้ว กรุณาสร้างฉบับใหม่'; end if;
  end if;
end; $$;

-- ---------------------------------------------------------------------
-- 4. A sent version stays frozen, including the new columns
-- ---------------------------------------------------------------------
create or replace function public.protect_contract_version()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.sent_at is not null then raise exception 'ไม่สามารถลบสัญญาฉบับที่ส่งให้ลูกค้าแล้ว'; end if;
    return old;
  end if;
  if new.id <> old.id or new.contract_id <> old.contract_id or new.version <> old.version
     or new.is_legacy <> old.is_legacy or new.created_at <> old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'ไม่สามารถเปลี่ยนข้อมูลอ้างอิงของฉบับสัญญา';
  end if;
  if old.sent_at is not null and
     (new.customer_name, new.customer_phone, new.customer_license_no, new.car_label, new.car_plate_no,
      new.pickup_location, new.pickup_at, new.return_at, new.rental_days, new.rental_price, new.deposit,
      new.mileage_allowance, new.late_penalty, new.additional_conditions, new.terms,
      new.customer_email, new.customer_address, new.customer_id_card_no, new.created_by_name)
     is distinct from
     (old.customer_name, old.customer_phone, old.customer_license_no, old.car_label, old.car_plate_no,
      old.pickup_location, old.pickup_at, old.return_at, old.rental_days, old.rental_price, old.deposit,
      old.mileage_allowance, old.late_penalty, old.additional_conditions, old.terms,
      old.customer_email, old.customer_address, old.customer_id_card_no, old.created_by_name) then
    raise exception 'สัญญาฉบับที่ส่งให้ลูกค้าแล้วแก้ไขไม่ได้ กรุณาสร้างฉบับใหม่';
  end if;
  if (old.sent_at is not null and new.sent_at is distinct from old.sent_at)
     or (old.accepted_at is not null and (new.accepted_at, new.accepted_by) is distinct from (old.accepted_at, old.accepted_by))
     or (old.approved_at is not null and (new.approved_at, new.approved_by) is distinct from (old.approved_at, old.approved_by))
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'ประวัติการส่ง ยอมรับ และอนุมัติสัญญาแก้ไขไม่ได้';
  end if;
  if old.superseded_at is not null and
     (new.accepted_at is distinct from old.accepted_at or new.approved_at is distinct from old.approved_at) then
    raise exception 'ฉบับสัญญานี้ถูกแทนที่แล้ว';
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------
-- 5. No licence, no booking
-- ---------------------------------------------------------------------
create or replace function public.require_booking_licence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p
                 where p.id = new.user_id and btrim(coalesce(p.license_no, '')) <> '') then
    raise exception 'กรุณากรอกเลขใบอนุญาตขับขี่ในโปรไฟล์ก่อนจองรถ' using errcode = '23514';
  end if;
  return new;
end; $$;
drop trigger if exists trg_require_booking_licence on public.bookings;
create trigger trg_require_booking_licence before insert on public.bookings
  for each row execute function public.require_booking_licence();

-- ---------------------------------------------------------------------
-- 6. Grants (internal helpers are not callable through the API, as in 0004)
-- ---------------------------------------------------------------------
revoke all on function public.render_contract_terms(text, int, text, text, text, text, text, text, timestamptz, timestamptz, int, numeric, numeric, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.write_contract_version(public.contracts, public.bookings, int, boolean, timestamptz, timestamptz, numeric, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.protect_contract_version() from public, anon, authenticated;
revoke all on function public.require_booking_licence() from public, anon, authenticated;
