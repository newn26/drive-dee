-- =====================================================================
-- Rollback for contract-customer-details.sql (restores the live behaviour before it).
-- write_contract_version is copied verbatim from 0007_booking_fee_flow.sql (the live version);
-- protect_contract_version is copied verbatim from 0004_contract_approval_workflow.sql (not
-- changed since). The 4 new contract_versions columns are KEPT (dropping them would lose
-- snapshot data); the restored functions simply stop filling them. Note: an unsent draft written
-- after the migration and edited in place after this rollback keeps its old email/address/ID
-- values in those columns while its text no longer shows them.
-- =====================================================================

-- No licence check on booking
drop trigger if exists trg_require_booking_licence on public.bookings;
drop function if exists public.require_booking_licence();

-- Contract versions written as in 0007 (licence only when _include_license)
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

-- Sent-version freeze as in 0004
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
      new.mileage_allowance, new.late_penalty, new.additional_conditions, new.terms)
     is distinct from
     (old.customer_name, old.customer_phone, old.customer_license_no, old.car_label, old.car_plate_no,
      old.pickup_location, old.pickup_at, old.return_at, old.rental_days, old.rental_price, old.deposit,
      old.mileage_allowance, old.late_penalty, old.additional_conditions, old.terms) then
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

-- The 20-argument contract text overload is no longer used
drop function if exists public.render_contract_terms(text, int, text, text, text, text, text, text, timestamptz, timestamptz, int, numeric, numeric, text, text, text, text, text, text, text);

revoke all on function public.write_contract_version(public.contracts, public.bookings, int, boolean, timestamptz, timestamptz, numeric, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.protect_contract_version() from public, anon, authenticated;

-- Optional, destroys the snapshot data in the new columns. Only if you really want them gone:
-- alter table public.contract_versions
--   drop column if exists customer_email,
--   drop column if exists customer_address,
--   drop column if exists customer_id_card_no,
--   drop column if exists created_by_name;
