-- =====================================================================
-- Roll back 0005_customer_self_accept_contract: restore the Admin-review contract workflow.
--
-- * Removes the automatic contract on booking (trigger + functions added by 0005).
-- * Restores guard_contract_update, customer_accept_contract and pay_booking exactly as
--   in 0004_contract_approval_workflow (copied verbatim).
-- Re-runnable. Contracts created automatically while 0005 was live stay as they are
-- (pending_customer ones continue in the normal Admin-review flow).
-- =====================================================================

drop trigger if exists trg_create_contract_on_booking on public.bookings;
drop function if exists public.create_contract_on_booking();
drop function if exists public.customer_prepare_contract(uuid);
drop function if exists public.start_customer_contract(public.bookings);

create or replace function public.guard_contract_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.contract_workflow', true), '') <> 'on' then
    raise exception 'สัญญาเช่าเปลี่ยนได้ผ่านขั้นตอนอนุมัติสัญญาเท่านั้น' using errcode = '42501';
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
      'pending_customer>pending_admin_review', 'pending_customer>revision_requested',
      'pending_customer>draft', 'pending_customer>cancelled',
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

create or replace function public.customer_accept_contract(_contract_id uuid, _version int)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'กรุณาเข้าสู่ระบบ' using errcode = '42501'; end if;
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null or c.user_id <> uid then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'pending_customer' then raise exception 'สัญญานี้ไม่อยู่ในสถานะรอลูกค้ายอมรับ'; end if;
  if _version is distinct from c.current_version or _version is distinct from c.sent_version then
    raise exception 'ฉบับสัญญาที่ยอมรับไม่ใช่ฉบับล่าสุด กรุณาโหลดหน้าใหม่';
  end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  perform set_config('app.contract_workflow', 'on', true);
  update public.contract_versions set accepted_at = now(), accepted_by = uid
    where contract_id = c.id and version = _version and sent_at is not null
      and superseded_at is null and accepted_at is null;
  if not found then raise exception 'ไม่สามารถยอมรับสัญญาฉบับนี้ได้'; end if;
  update public.contracts set status = 'pending_admin_review', customer_accepted_at = now() where id = c.id;
  update public.bookings set hold_expires_at = public.contract_hold_until(b.start_date, interval '24 hours')
    where id = b.id;
  perform public.log_contract_event(c.id, b.id, _version, 'accepted', null);
end; $$;

create or replace function public.pay_booking(_booking_id uuid, _method payment_method, _card_last4 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; c public.contracts; v public.contract_versions; pid uuid; ref text;
begin
  select * into b from public.bookings where id = _booking_id and user_id = auth.uid() for update;
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status <> 'pending' then raise exception 'การจองนี้ชำระเงินแล้วหรือถูกยกเลิก'; end if;
  if b.hold_expires_at is null or b.hold_expires_at <= now() then
    raise exception 'หมดเวลาชำระเงิน กรุณาจองใหม่อีกครั้ง';
  end if;
  select * into c from public.contracts where booking_id = b.id for update;
  if c.id is null or c.status <> 'approved' then
    raise exception 'ยังชำระเงินไม่ได้ ต้องรอผู้ดูแลอนุมัติสัญญาก่อน';
  end if;
  select * into v from public.contract_versions where contract_id = c.id and version = c.current_version;
  if v.id is null or v.sent_at is null or v.accepted_at is null or v.approved_at is null
     or v.superseded_at is not null or v.accepted_by is distinct from b.user_id then
    raise exception 'สัญญาฉบับปัจจุบันยังไม่ได้รับการยอมรับและอนุมัติ';
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
  values (b.id, b.user_id, _method, v.rental_price, 'paid', _card_last4, ref)
  returning id into pid;
  update public.bookings set status = 'confirmed' where id = b.id;
  perform set_config('app.contract_workflow', 'on', true);
  update public.contracts set status = 'paid', paid_at = now() where id = c.id;
  perform public.log_contract_event(c.id, b.id, c.current_version, 'paid', 'DEMO ' || _method || ' อ้างอิง ' || ref);
  return pid;
end; $$;
