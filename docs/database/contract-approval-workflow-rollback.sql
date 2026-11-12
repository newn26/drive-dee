-- =====================================================================
-- ROLLBACK (level 1, functional) for docs/database/contract-approval-workflow.sql
-- PROPOSED — NOT APPLIED. Restores the pre-migration behaviour of the app.
--
-- Keeps every row and every new table/column (contract_versions, contract_events,
-- admin_members, admin_invitations, admin_audit_log, bookings.hold_expires_at,
-- payments.refund_status): history is not lost, the old app simply ignores it.
-- Keeps the payments duplicate-paid index and the revoked client writes on
-- user_roles/payments (the old app never writes those tables directly).
-- Function bodies below are copied verbatim from migrations 0000 and 0002.
-- Tested in src/test/db/rollback.db.test.ts.
-- =====================================================================

-- 1. Triggers added by the migration
drop trigger if exists trg_guard_contract_update on public.contracts;
drop trigger if exists trg_booking_cancel_contract on public.bookings;
drop trigger if exists user_roles_guard_admin_grant on public.user_roles;
drop trigger if exists user_roles_track_admin_member on public.user_roles;

-- 2. Contracts back to the old statuses (unsent drafts get their draft text)
alter table public.contracts drop constraint if exists contracts_status_check;
update public.contracts c set terms = v.terms
  from public.contract_versions v
  where v.contract_id = c.id and v.version = c.current_version and c.terms = '';
update public.contracts set status = case when customer_accepted_at is not null then 'accepted' else 'active' end;
alter table public.contracts alter column status set default 'active';

-- 3. Original contract policies and grants
drop policy if exists "contracts read" on public.contracts;
drop policy if exists "contracts update" on public.contracts;
create policy "contracts read" on public.contracts for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "contracts update" on public.contracts for update to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
grant select, update on public.contracts to authenticated;

-- 4. Original admin policies on cars / maintenance / reviews
drop policy if exists "cars admin insert" on public.cars;
drop policy if exists "cars admin update" on public.cars;
drop policy if exists "cars admin delete" on public.cars;
create policy "cars admin write" on public.cars for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
drop policy if exists "maint admin read" on public.maintenance;
drop policy if exists "maint admin insert" on public.maintenance;
drop policy if exists "maint admin update" on public.maintenance;
drop policy if exists "maint admin delete" on public.maintenance;
create policy "maint admin" on public.maintenance for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
drop policy if exists "reviews delete admin" on public.reviews;
create policy "reviews delete admin" on public.reviews for delete to authenticated using (public.has_role(auth.uid(),'admin'));

-- 5. Original has_role (suspension no longer applies) and booking/payment functions
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;

create or replace function public.validate_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare p numeric;
begin
  if new.end_date < new.start_date then raise exception 'วันคืนรถต้องไม่ก่อนวันรับรถ'; end if;
  if tg_op = 'INSERT' then
    if new.start_date < (now() at time zone 'Asia/Bangkok')::date then raise exception 'ไม่สามารถจองย้อนหลังได้'; end if;
    select price_per_day into p from public.cars where id = new.car_id and status <> 'unavailable';
    if p is null then raise exception 'รถคันนี้ไม่พร้อมให้เช่า'; end if;
    if exists (select 1 from public.bookings b where b.car_id = new.car_id
      and (b.status in ('confirmed','active') or (b.status = 'pending' and b.created_at > now() - interval '15 minutes'))
      and daterange(b.start_date, b.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
      raise exception 'รถคันนี้ถูกจองในช่วงวันที่เลือกแล้ว';
    end if;
    new.days := (new.end_date - new.start_date) + 1;
    new.total_amount := p * new.days;
  end if;
  if tg_op = 'UPDATE' and not public.has_role(auth.uid(), 'admin') then
    if new.status <> old.status
       and not (old.status in ('pending','confirmed') and new.status = 'cancelled')
       and not (old.status = 'pending' and new.status = 'confirmed'
                and exists (select 1 from public.payments p where p.booking_id = new.id and p.status = 'paid')) then
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
    end if;
    new.total_amount := old.total_amount; new.start_date := old.start_date;
    new.end_date := old.end_date; new.car_id := old.car_id;
  end if;
  return new;
end; $$;

create or replace function public.booked_car_ids(_start date, _end date)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct car_id from public.bookings
  where (status in ('confirmed','active') or (status = 'pending' and created_at > now() - interval '15 minutes'))
    and daterange(start_date, end_date, '[]') && daterange(_start, _end, '[]')
$$;

create or replace function public.pay_booking(_booking_id uuid, _method payment_method, _card_last4 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; c public.cars; pid uuid;
begin
  select * into b from public.bookings where id = _booking_id and user_id = auth.uid() for update;
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status <> 'pending' then raise exception 'การจองนี้ชำระเงินแล้วหรือถูกยกเลิก'; end if;
  if b.created_at <= now() - interval '15 minutes' then raise exception 'หมดเวลาชำระเงิน กรุณาจองใหม่อีกครั้ง'; end if;
  if _method = 'card' and (_card_last4 is null or _card_last4 !~ '^[0-9]{4}$') then raise exception 'ข้อมูลบัตรไม่ถูกต้อง'; end if;
  if _method = 'qr' then _card_last4 := null; end if;

  insert into public.payments(booking_id, user_id, method, amount, status, card_last4, reference)
  values (b.id, b.user_id, _method, b.total_amount, 'paid', _card_last4, 'DEMO-' || upper(substr(md5(random()::text), 1, 10)))
  returning id into pid;
  update public.bookings set status = 'confirmed' where id = b.id;

  select * into c from public.cars where id = b.car_id;
  insert into public.contracts(booking_id, user_id, terms) values (b.id, b.user_id,
    'สัญญาเช่ารถยนต์ ' || c.brand || ' ' || c.model || ' ทะเบียน ' || c.plate_no || E'\n' ||
    'ระยะเวลาเช่า: ' || to_char(b.start_date,'DD/MM/YYYY') || ' ถึง ' || to_char(b.end_date,'DD/MM/YYYY') || ' (' || b.days || ' วัน)' || E'\n' ||
    'ค่าเช่ารวม: ' || to_char(b.total_amount,'FM999,999,990.00') || ' บาท' || E'\n\n' ||
    '1. ผู้เช่าต้องมีใบอนุญาตขับขี่ที่ยังไม่หมดอายุ' || E'\n' ||
    '2. ผู้เช่าต้องคืนรถตามวันและเวลาที่กำหนด หากคืนล่าช้าคิดค่าปรับวันละ 1 เท่าของค่าเช่ารายวัน' || E'\n' ||
    '3. ผู้เช่าต้องคืนรถพร้อมน้ำมันในระดับเดียวกับวันรับรถ' || E'\n' ||
    '4. ห้ามนำรถไปใช้ในทางผิดกฎหมาย หรือให้บุคคลอื่นเช่าช่วง' || E'\n' ||
    '5. กรณีเกิดอุบัติเหตุ ผู้เช่าต้องแจ้งบริษัทภายใน 24 ชั่วโมง')
  on conflict (booking_id) do nothing;
  return pid;
end; $$;

-- 6. Workflow and admin-management API functions
drop function if exists public.admin_create_contract(uuid, timestamptz, timestamptz, numeric, text, text, text, boolean);
drop function if exists public.admin_update_contract(uuid, timestamptz, timestamptz, numeric, text, text, text, boolean);
drop function if exists public.admin_send_contract(uuid);
drop function if exists public.customer_accept_contract(uuid, int);
drop function if exists public.customer_request_revision(uuid, int, text);
drop function if exists public.admin_approve_contract(uuid, int);
drop function if exists public.admin_request_revision(uuid, int, text);
drop function if exists public.owner_manual_confirm_booking(uuid, text);
drop function if exists public.expire_stale_bookings();
drop function if exists public.owner_create_admin_invitation(text, text[]);
drop function if exists public.owner_revoke_admin_invitation(uuid);
drop function if exists public.accept_admin_invitation(text);
drop function if exists public.owner_set_admin_permissions(uuid, text[]);
drop function if exists public.owner_set_admin_status(uuid, text, text);
drop function if exists public.bootstrap_owner(text);
