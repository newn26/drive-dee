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
