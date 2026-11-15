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
