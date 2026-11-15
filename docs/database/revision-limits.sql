-- =====================================================================
-- Contract revision rules (runs after 0007_booking_fee_flow)
--
-- 1. A customer may ask for changes at most 2 times per contract. Every request renews the
--    car's hold, so without a limit a customer could keep a car held without paying.
-- 2. A customer's requested name is no longer written to their profile when they ask.
--    The admin applies it with admin_apply_requested_name(), which only accepts the exact
--    name in the customer's open request and records it in the contract history.
--
-- No table, policy or data changes. Re-runnable (create or replace).
-- =====================================================================

create or replace function public.max_customer_revisions()
returns int language sql immutable set search_path = public as $$ select 2 $$;

-- 0004's function plus the limit (unchanged otherwise).
create or replace function public.customer_request_revision(_contract_id uuid, _version int, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'กรุณาเข้าสู่ระบบ' using errcode = '42501'; end if;
  if length(btrim(coalesce(_reason, ''))) < 5 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'; end if;
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null or c.user_id <> uid then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'pending_customer' then raise exception 'ขอแก้ไขได้เฉพาะสัญญาที่รอลูกค้าตรวจสอบ'; end if;
  if _version is distinct from c.sent_version then raise exception 'ฉบับสัญญาไม่ใช่ฉบับล่าสุด กรุณาโหลดหน้าใหม่'; end if;
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

-- The admin applies the name from the customer's open request (contract text uses the profile name).
create or replace function public.admin_apply_requested_name(_contract_id uuid, _name text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; n text := btrim(coalesce(_name, ''));
begin
  perform public.require_admin_permission('contracts_manage');
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'revision_requested' or c.revision_requested_by is distinct from 'customer' then
    raise exception 'สัญญานี้ไม่มีคำขอแก้ไขจากลูกค้า';
  end if;
  if length(n) < 2 or length(n) > 100 then raise exception 'ชื่อลูกค้าไม่ถูกต้อง'; end if;
  if position(('ชื่อลูกค้า: ' || n || E'\n') in (replace(coalesce(c.revision_reason, ''), E'\r', '') || E'\n')) <> 1 then
    raise exception 'ชื่อไม่ตรงกับที่ลูกค้าขอแก้ไข';
  end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  update public.profiles set full_name = n, updated_at = now() where id = c.user_id;
  perform public.log_contract_event(c.id, b.id, c.current_version, 'edited',
    'เปลี่ยนชื่อผู้เช่าตามคำขอของลูกค้า: ' || n);
end; $$;

revoke all on function public.max_customer_revisions() from public, anon;
grant execute on function public.max_customer_revisions() to authenticated;
revoke all on function public.customer_request_revision(uuid, int, text) from public, anon;
grant execute on function public.customer_request_revision(uuid, int, text) to authenticated;
revoke all on function public.admin_apply_requested_name(uuid, text) from public, anon;
grant execute on function public.admin_apply_requested_name(uuid, text) to authenticated;
