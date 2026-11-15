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
