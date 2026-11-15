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
