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
