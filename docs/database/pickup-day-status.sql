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
