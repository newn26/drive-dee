-- =====================================================================
-- Drive Dee: contract approval workflow + Owner/Admin management
-- PROPOSED MIGRATION — NOT APPLIED. Review before sending to Lovable.
--
-- Additive: no table, column or row is deleted. Existing contracts are
-- kept and mapped to the new statuses with an immutable version 1.
-- Existing admins stay admins; NOBODY is made Owner by this migration
-- (see bootstrap_owner at the end, a separate approved step).
-- Tested against drizzle/migrations 0000-0003 in src/test/db (PGlite).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Admin management foundation (has_role now honours suspension)
-- ---------------------------------------------------------------------
create or replace function public.admin_permission_list()
returns text[] language sql immutable set search_path = public as $$
  select array['contracts_manage','contracts_approve','bookings_manage','fleet_manage','reviews_moderate']
$$;

create table if not exists public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  is_owner boolean not null default false,
  status text not null default 'active',
  permissions text[] not null default array['contracts_manage','contracts_approve','bookings_manage','fleet_manage','reviews_moderate'],
  status_reason text,
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_members_status_check check (status in ('active','suspended','revoked')),
  constraint admin_members_permissions_check check (permissions <@ array['contracts_manage','contracts_approve','bookings_manage','fleet_manage','reviews_moderate']),
  constraint admin_members_owner_active check (not is_owner or status = 'active')
);
-- At most one Owner.
create unique index if not exists admin_members_one_owner on public.admin_members ((true)) where is_owner;

-- Existing admins become active members with every permission. Not Owner.
insert into public.admin_members (user_id, email)
select r.user_id, coalesce(lower(u.email), '')
from public.user_roles r join auth.users u on u.id = r.user_id
where r.role = 'admin'
on conflict (user_id) do nothing;

-- A suspended or revoked admin is not an admin anywhere (every RLS policy uses has_role).
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
     and (_role <> 'admin' or not exists (
           select 1 from public.admin_members m where m.user_id = _user_id and m.status <> 'active'))
$$;

create or replace function public.is_owner(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin') and exists (
    select 1 from public.admin_members m where m.user_id = _user_id and m.is_owner and m.status = 'active')
$$;

create or replace function public.has_admin_permission(_user_id uuid, _permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(_user_id, 'admin') and (
    public.is_owner(_user_id)
    or coalesce((select _permission = any (m.permissions) from public.admin_members m where m.user_id = _user_id), false))
$$;

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_user_id uuid,
  target_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_log_action_check check (action in (
    'admin_role_granted','owner_bootstrapped','invite_created','invite_revoked','invite_accepted',
    'permissions_changed','admin_suspended','admin_reactivated','admin_revoked','booking_manual_confirm'))
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

create table if not exists public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  permissions text[] not null,
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  constraint admin_invitations_email_check check (email = lower(btrim(email)) and email like '%_@_%'),
  constraint admin_invitations_permissions_check check (
    cardinality(permissions) > 0
    and permissions <@ array['contracts_manage','contracts_approve','bookings_manage','fleet_manage','reviews_moderate'])
);
create unique index if not exists admin_invitations_one_open
  on public.admin_invitations (email) where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------
-- 2. Booking hold
-- ---------------------------------------------------------------------
alter table public.bookings add column if not exists hold_expires_at timestamptz;

-- Pending bookings that exist right now keep today's 15-minute rule.
update public.bookings set hold_expires_at = created_at + interval '15 minutes'
where status = 'pending' and hold_expires_at is null;

create index if not exists bookings_pending_hold_idx
  on public.bookings (car_id, hold_expires_at) where status = 'pending';

-- Review-stage hold: now + span, but never past midnight after the pickup date (Bangkok).
create or replace function public.contract_hold_until(_start_date date, _span interval)
returns timestamptz language sql stable set search_path = public as $$
  select least(now() + _span, ((_start_date + 1)::timestamp at time zone 'Asia/Bangkok'))
$$;

-- The single rule for "does this booking hold the car right now".
create or replace function public.booking_blocks_car(_status public.booking_status, _hold_expires_at timestamptz)
returns boolean language sql stable set search_path = public as $$
  select _status in ('confirmed','active') or (_status = 'pending' and _hold_expires_at > now())
$$;

create or replace function public.booked_car_ids(_start date, _end date)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct car_id from public.bookings
  where public.booking_blocks_car(status, hold_expires_at)
    and daterange(start_date, end_date, '[]') && daterange(_start, _end, '[]')
$$;

-- ---------------------------------------------------------------------
-- 3. Contracts: new columns, versions, events
-- ---------------------------------------------------------------------
alter table public.contracts
  add column if not exists current_version int not null default 1,
  add column if not exists sent_version int,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists paid_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists revision_reason text,
  add column if not exists revision_requested_by text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.contracts alter column status set default 'draft';

create table if not exists public.contract_versions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  version int not null check (version >= 1),
  is_legacy boolean not null default false,
  customer_name text,
  customer_phone text,
  customer_license_no text,
  car_label text,
  car_plate_no text,
  pickup_location text,
  pickup_at timestamptz,
  return_at timestamptz,
  rental_days int,
  rental_price numeric(10,2) check (rental_price >= 0),
  deposit numeric(10,2) check (deposit >= 0),
  mileage_allowance text,
  late_penalty text,
  additional_conditions text not null default '',
  terms text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  superseded_at timestamptz,
  constraint contract_versions_unique unique (contract_id, version),
  constraint contract_versions_fields check (is_legacy or (
    customer_name is not null and car_label is not null and car_plate_no is not null
    and pickup_location is not null and pickup_at is not null and return_at is not null
    and rental_days is not null and rental_price is not null and deposit is not null
    and mileage_allowance is not null and late_penalty is not null)),
  constraint contract_versions_times check (pickup_at is null or return_at is null or return_at > pickup_at),
  constraint contract_versions_accept_pair check ((accepted_at is null) = (accepted_by is null)),
  constraint contract_versions_approve_pair check ((approved_at is null) = (approved_by is null)),
  constraint contract_versions_accept_needs_send check (accepted_at is null or sent_at is not null),
  constraint contract_versions_approve_needs_accept check (approved_at is null or accepted_at is not null)
);
create unique index if not exists contract_versions_one_live
  on public.contract_versions (contract_id) where superseded_at is null;

create table if not exists public.contract_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.contracts(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  version int,
  actor_id uuid,
  actor_role text not null check (actor_role in ('owner','admin','customer','system')),
  action text not null check (action in ('legacy_import','created','edited','sent','accepted',
    'revision_requested','approved','paid','cancelled','expired','manual_confirm')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists contract_events_contract_idx on public.contract_events (contract_id, created_at);
create index if not exists contract_events_booking_idx on public.contract_events (booking_id, created_at);

-- ---------------------------------------------------------------------
-- 4. Keep existing contracts (before any guard trigger exists)
-- ---------------------------------------------------------------------
insert into public.contract_versions (contract_id, version, is_legacy, terms, created_at, sent_at, accepted_at, accepted_by)
select c.id, 1, true, c.terms, c.created_at, c.created_at, c.customer_accepted_at,
       case when c.customer_accepted_at is not null then c.user_id end
from public.contracts c
where not exists (select 1 from public.contract_versions v where v.contract_id = c.id);

insert into public.contract_events (contract_id, booking_id, version, actor_role, action, note, created_at)
select c.id, c.booking_id, 1, 'system', 'legacy_import',
       'สัญญาเดิมก่อนระบบอนุมัติสัญญา (สถานะเดิม: ' || c.status || ')', c.created_at
from public.contracts c
where c.status in ('active','accepted');

update public.contracts c set
  status = case when b.status = 'cancelled' then 'cancelled' else 'paid' end,
  sent_version = 1,
  current_version = 1,
  paid_at = (select min(p.paid_at) from public.payments p where p.booking_id = c.booking_id and p.status = 'paid'),
  cancelled_at = case when b.status = 'cancelled' then now() end
from public.bookings b
where b.id = c.booking_id and c.status in ('active','accepted');

alter table public.contracts add constraint contracts_status_check check (status in
  ('draft','pending_customer','pending_admin_review','revision_requested','approved','paid','cancelled'));
alter table public.contracts add constraint contracts_revision_by_check
  check (revision_requested_by is null or revision_requested_by in ('customer','admin'));
create index if not exists contracts_status_idx on public.contracts (status);

-- ---------------------------------------------------------------------
-- 5. Payments: duplicate guard + refund status (cancellation != refund)
-- ---------------------------------------------------------------------
create unique index if not exists payments_one_paid_per_booking
  on public.payments (booking_id) where status = 'paid';

alter table public.payments add column if not exists refund_status text not null default 'none';
alter table public.payments add constraint payments_refund_status_check
  check (refund_status in ('none','not_refunded','refunded'));
-- Paid bookings that were already cancelled: payment kept, no refund was made.
update public.payments p set refund_status = 'not_refunded'
from public.bookings b
where b.id = p.booking_id and b.status = 'cancelled' and p.status = 'paid' and p.refund_status = 'none';

-- ---------------------------------------------------------------------
-- 6. Internal helpers (not callable through the API)
-- ---------------------------------------------------------------------
create or replace function public.require_admin_permission(_permission text)
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_admin_permission(auth.uid(), _permission) then
    raise exception 'ไม่มีสิทธิ์ดำเนินการนี้ (%)', _permission using errcode = '42501';
  end if;
  return auth.uid();
end; $$;

create or replace function public.require_owner()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_owner(auth.uid()) then
    raise exception 'เฉพาะเจ้าของระบบ (Owner) เท่านั้น' using errcode = '42501';
  end if;
  return auth.uid();
end; $$;

create or replace function public.log_admin_audit(
  _action text, _target_user_id uuid, _target_email text, _details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_audit_log (actor_id, action, target_user_id, target_email, details)
  values (auth.uid(), _action, _target_user_id, _target_email, coalesce(_details, '{}'::jsonb));
end; $$;

create or replace function public.assert_booking_open(_b public.bookings)
returns void language plpgsql stable set search_path = public as $$
begin
  if _b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if _b.status <> 'pending' then
    raise exception 'การจองนี้ไม่อยู่ในขั้นตอนทำสัญญา (สถานะ: %)', _b.status;
  end if;
  if _b.hold_expires_at is null or _b.hold_expires_at <= now() then
    raise exception 'การจองนี้หมดเวลาแล้ว กรุณาจองใหม่';
  end if;
end; $$;

create or replace function public.log_contract_event(
  _contract_id uuid, _booking_id uuid, _version int, _action text, _note text, _system boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.contract_events (contract_id, booking_id, version, actor_id, actor_role, action, note)
  values (_contract_id, _booking_id, _version,
    case when _system then null else auth.uid() end,
    case when _system or auth.uid() is null then 'system'
         when public.is_owner(auth.uid()) then 'owner'
         when public.has_role(auth.uid(), 'admin') then 'admin' else 'customer' end,
    _action, nullif(btrim(coalesce(_note, '')), ''));
end; $$;

create or replace function public.render_contract_terms(
  _contract_no text, _version int, _customer_name text, _customer_phone text, _customer_license_no text,
  _car_label text, _car_plate_no text, _pickup_location text, _pickup_at timestamptz, _return_at timestamptz,
  _rental_days int, _rental_price numeric, _deposit numeric, _mileage_allowance text, _late_penalty text,
  _additional_conditions text)
returns text language sql stable set search_path = public as $$
  select concat_ws(E'\n',
    'สัญญาเช่ารถยนต์ เลขที่ ' || _contract_no || ' (ฉบับที่ ' || _version || ')',
    'ผู้เช่า: ' || _customer_name || coalesce(' โทร ' || nullif(_customer_phone, ''), ''),
    case when _customer_license_no is not null then 'เลขที่ใบอนุญาตขับขี่: ' || _customer_license_no end,
    'รถยนต์: ' || _car_label || ' ทะเบียน ' || _car_plate_no,
    'สถานที่รับรถ: ' || _pickup_location,
    'รับรถ: ' || to_char(_pickup_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') || ' น.',
    'คืนรถ: ' || to_char(_return_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') || ' น. (' || _rental_days || ' วัน)',
    'ค่าเช่ารวม: ' || to_char(_rental_price, 'FM999,999,990.00') || ' บาท',
    'เงินประกันความเสียหาย: ' || to_char(_deposit, 'FM999,999,990.00') || ' บาท (ชำระ ณ วันรับรถ ไม่รวมในการชำระเงินออนไลน์)',
    'ข้อกำหนดระยะทาง: ' || _mileage_allowance,
    'ค่าปรับส่งคืนรถล่าช้า: ' || _late_penalty,
    '',
    '1. ผู้เช่าต้องมีใบอนุญาตขับขี่ที่ยังไม่หมดอายุ',
    '2. ผู้เช่าต้องคืนรถตามวันและเวลาที่กำหนด หากคืนล่าช้าจะคิดค่าปรับตามที่ระบุข้างต้น',
    '3. ผู้เช่าต้องคืนรถพร้อมน้ำมันในระดับเดียวกับวันรับรถ',
    '4. ห้ามนำรถไปใช้ในทางผิดกฎหมาย หรือให้บุคคลอื่นเช่าช่วง',
    '5. กรณีเกิดอุบัติเหตุ ผู้เช่าต้องแจ้งบริษัทภายใน 24 ชั่วโมง',
    case when btrim(coalesce(_additional_conditions, '')) <> ''
         then E'\nเงื่อนไขเพิ่มเติม:\n' || btrim(_additional_conditions) end)
$$;

-- Writes (insert) or rewrites (unsent draft only) one version from the booking + profile snapshot.
-- Rental price and days always come from the booking.
create or replace function public.write_contract_version(
  _contract public.contracts, _b public.bookings, _version int, _is_new boolean,
  _pickup_at timestamptz, _return_at timestamptz, _deposit numeric,
  _mileage_allowance text, _late_penalty text, _additional_conditions text, _include_license boolean)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.profiles; car public.cars; lic text; t text; label text;
begin
  if _pickup_at is null or _return_at is null then raise exception 'กรุณาระบุวันและเวลารับ-คืนรถ'; end if;
  if (_pickup_at at time zone 'Asia/Bangkok')::date <> _b.start_date then
    raise exception 'วันรับรถต้องตรงกับวันที่จอง (%)', to_char(_b.start_date, 'DD/MM/YYYY');
  end if;
  if (_return_at at time zone 'Asia/Bangkok')::date <> _b.end_date then
    raise exception 'วันคืนรถต้องตรงกับวันที่จอง (%)', to_char(_b.end_date, 'DD/MM/YYYY');
  end if;
  if _return_at <= _pickup_at then raise exception 'เวลาคืนรถต้องหลังเวลารับรถ'; end if;
  if _deposit is null or _deposit < 0 then raise exception 'เงินประกันต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'; end if;
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

-- ---------------------------------------------------------------------
-- 7. Guard triggers
-- ---------------------------------------------------------------------
-- Contracts change only inside the workflow functions, and only along allowed transitions.
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
drop trigger if exists trg_guard_contract_update on public.contracts;
create trigger trg_guard_contract_update before update on public.contracts
  for each row execute function public.guard_contract_update();

-- A version is immutable once sent; stamps are write-once.
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
drop trigger if exists trg_protect_contract_version on public.contract_versions;
create trigger trg_protect_contract_version before update or delete on public.contract_versions
  for each row execute function public.protect_contract_version();

create or replace function public.append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'บันทึกนี้แก้ไขหรือลบไม่ได้ (append-only: %)', tg_table_name;
end; $$;
drop trigger if exists trg_contract_events_append_only on public.contract_events;
create trigger trg_contract_events_append_only before update or delete on public.contract_events
  for each row execute function public.append_only();
drop trigger if exists trg_admin_audit_append_only on public.admin_audit_log;
create trigger trg_admin_audit_append_only before update or delete on public.admin_audit_log
  for each row execute function public.append_only();

-- Admin role: only the SQL editor/service role (no auth.uid()) or an accepted invitation may grant it.
create or replace function public.guard_admin_role_grant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'admin' and (tg_op = 'INSERT' or old.role is distinct from new.role) then
    if auth.uid() is not null and coalesce(current_setting('app.admin_invite', true), '') <> 'on' then
      raise exception 'สิทธิ์ผู้ดูแลระบบให้ได้ผ่านคำเชิญจากเจ้าของระบบเท่านั้น' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists user_roles_guard_admin_grant on public.user_roles;
create trigger user_roles_guard_admin_grant before insert or update on public.user_roles
  for each row execute function public.guard_admin_role_grant();

-- Every admin has a member row (so suspension/permissions always apply).
create or replace function public.track_admin_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare em text;
begin
  if new.role = 'admin' then
    select coalesce(lower(email), '') into em from auth.users where id = new.user_id;
    insert into public.admin_members (user_id, email) values (new.user_id, coalesce(em, ''))
    on conflict (user_id) do nothing;
    if coalesce(current_setting('app.admin_invite', true), '') <> 'on' then
      perform public.log_admin_audit('admin_role_granted', new.user_id, em,
        jsonb_build_object('source', case when auth.uid() is null then 'sql_or_service' else 'app' end));
    end if;
  end if;
  return null;
end; $$;
drop trigger if exists user_roles_track_admin_member on public.user_roles;
create trigger user_roles_track_admin_member after insert on public.user_roles
  for each row execute function public.track_admin_member();

-- Bookings: stage-based hold; no status change that bypasses contract + payment.
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
      null;
    else
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
    end if;
    if new.status <> 'pending' then new.hold_expires_at := null; end if;
  end if;
  return new;
end; $$;

-- Cancelling or expiring a booking cancels its contract; a paid booking keeps its payment
-- (payment status stays 'paid', refund_status = 'not_refunded').
create or replace function public.cancel_contract_with_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.contracts; paid boolean;
        expired boolean := coalesce(current_setting('app.cancel_reason', true), '') = 'expired';
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.payments set refund_status = 'not_refunded'
      where booking_id = new.id and status = 'paid' and refund_status = 'none';
    paid := found;
    select * into c from public.contracts where booking_id = new.id;
    if c.id is not null and c.status <> 'cancelled' then
      perform set_config('app.contract_workflow', 'on', true);
      update public.contracts set status = 'cancelled', cancelled_at = now() where id = c.id;
      perform public.log_contract_event(c.id, new.id, c.current_version,
        case when expired then 'expired' else 'cancelled' end,
        case when paid then 'ยกเลิกหลังชำระเงิน: เก็บประวัติการชำระไว้ ยังไม่มีการคืนเงิน (DEMO)' end,
        expired);
    end if;
  end if;
  return null;
end; $$;
drop trigger if exists trg_booking_cancel_contract on public.bookings;
create trigger trg_booking_cancel_contract after update of status on public.bookings
  for each row execute function public.cancel_contract_with_booking();

-- ---------------------------------------------------------------------
-- 8. Contract workflow functions (the only way to change contracts)
-- ---------------------------------------------------------------------
create or replace function public.admin_create_contract(
  _booking_id uuid, _pickup_at timestamptz, _return_at timestamptz, _deposit numeric,
  _mileage_allowance text, _late_penalty text, _additional_conditions text default '',
  _include_license boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; c public.contracts;
begin
  perform public.require_admin_permission('contracts_manage');
  select * into b from public.bookings where id = _booking_id for update;
  perform public.assert_booking_open(b);
  if exists (select 1 from public.contracts where booking_id = b.id) then
    raise exception 'การจองนี้มีสัญญาอยู่แล้ว' using errcode = '23505';
  end if;
  insert into public.contracts (booking_id, user_id, terms, status, current_version)
  values (b.id, b.user_id, '', 'draft', 1) returning * into c;
  perform public.write_contract_version(c, b, 1, true, _pickup_at, _return_at, _deposit,
    _mileage_allowance, _late_penalty, _additional_conditions, _include_license);
  perform public.log_contract_event(c.id, b.id, 1, 'created', null);
  return c.id;
end; $$;

create or replace function public.admin_update_contract(
  _contract_id uuid, _pickup_at timestamptz, _return_at timestamptz, _deposit numeric,
  _mileage_allowance text, _late_penalty text, _additional_conditions text default '',
  _include_license boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; v public.contract_versions; nv int;
begin
  perform public.require_admin_permission('contracts_manage');
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null then raise exception 'ไม่พบสัญญา'; end if;
  if c.status in ('paid','cancelled') then
    raise exception 'สัญญาที่ชำระเงินแล้วหรือยกเลิกแล้วแก้ไขไม่ได้';
  end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  select * into v from public.contract_versions where contract_id = c.id and version = c.current_version;
  perform set_config('app.contract_workflow', 'on', true);

  if v.sent_at is null then
    -- Unsent draft: edit in place
    perform public.write_contract_version(c, b, c.current_version, false, _pickup_at, _return_at,
      _deposit, _mileage_allowance, _late_penalty, _additional_conditions, _include_license);
    update public.contracts set updated_at = now() where id = c.id;
    perform public.log_contract_event(c.id, b.id, c.current_version, 'edited', null);
    return c.current_version;
  end if;

  -- Sent version: never overwritten. Supersede it and start a new draft version.
  nv := c.current_version + 1;
  update public.contract_versions set superseded_at = now() where id = v.id;
  perform public.write_contract_version(c, b, nv, true, _pickup_at, _return_at, _deposit,
    _mileage_allowance, _late_penalty, _additional_conditions, _include_license);
  update public.contracts set current_version = nv, status = 'draft', customer_accepted_at = null,
    approved_at = null, approved_by = null where id = c.id;
  update public.bookings set hold_expires_at = public.contract_hold_until(b.start_date, interval '24 hours')
    where id = b.id;
  perform public.log_contract_event(c.id, b.id, nv, 'edited', 'ฉบับที่ ' || nv || ' แทนฉบับที่ ' || v.version);
  return nv;
end; $$;

create or replace function public.admin_send_contract(_contract_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; t text;
begin
  perform public.require_admin_permission('contracts_manage');
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'draft' then raise exception 'ส่งได้เฉพาะสัญญาฉบับร่าง'; end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  perform set_config('app.contract_workflow', 'on', true);
  update public.contract_versions set sent_at = now()
    where contract_id = c.id and version = c.current_version and sent_at is null
    returning terms into t;
  if t is null then raise exception 'ไม่พบฉบับร่างที่จะส่ง'; end if;
  update public.contracts set status = 'pending_customer', sent_version = c.current_version, terms = t,
    customer_accepted_at = null, revision_reason = null, revision_requested_by = null where id = c.id;
  update public.bookings set hold_expires_at = public.contract_hold_until(b.start_date, interval '24 hours')
    where id = b.id;
  perform public.log_contract_event(c.id, b.id, c.current_version, 'sent', null);
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
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  perform set_config('app.contract_workflow', 'on', true);
  update public.contracts set status = 'revision_requested', revision_reason = btrim(_reason),
    revision_requested_by = 'customer' where id = c.id;
  update public.bookings set hold_expires_at = public.contract_hold_until(b.start_date, interval '24 hours')
    where id = b.id;
  perform public.log_contract_event(c.id, b.id, _version, 'revision_requested', btrim(_reason));
end; $$;

create or replace function public.admin_approve_contract(_contract_id uuid, _version int)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings; uid uuid;
begin
  uid := public.require_admin_permission('contracts_approve');
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'pending_admin_review' then raise exception 'อนุมัติได้เฉพาะสัญญาที่ลูกค้ายอมรับแล้ว'; end if;
  if _version is distinct from c.current_version then raise exception 'ฉบับสัญญาไม่ใช่ฉบับล่าสุด'; end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  perform set_config('app.contract_workflow', 'on', true);
  update public.contract_versions set approved_at = now(), approved_by = uid
    where contract_id = c.id and version = _version and accepted_at is not null
      and accepted_by = c.user_id and superseded_at is null and approved_at is null;
  if not found then raise exception 'ฉบับนี้ยังไม่ได้รับการยอมรับจากลูกค้า'; end if;
  update public.contracts set status = 'approved', approved_at = now(), approved_by = uid where id = c.id;
  -- Stage 4: the existing 15-minute payment window starts now (not capped)
  update public.bookings set hold_expires_at = now() + interval '15 minutes' where id = b.id;
  perform public.log_contract_event(c.id, b.id, _version, 'approved', null);
end; $$;

create or replace function public.admin_request_revision(_contract_id uuid, _version int, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contracts; b public.bookings;
begin
  perform public.require_admin_permission('contracts_approve');
  if length(btrim(coalesce(_reason, ''))) < 5 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'; end if;
  select * into c from public.contracts where id = _contract_id for update;
  if c.id is null then raise exception 'ไม่พบสัญญา'; end if;
  if c.status <> 'pending_admin_review' then raise exception 'ขอแก้ไขได้เฉพาะสัญญาที่รอผู้ดูแลตรวจสอบ'; end if;
  if _version is distinct from c.current_version then raise exception 'ฉบับสัญญาไม่ใช่ฉบับล่าสุด'; end if;
  select * into b from public.bookings where id = c.booking_id for update;
  perform public.assert_booking_open(b);
  perform set_config('app.contract_workflow', 'on', true);
  update public.contracts set status = 'revision_requested', revision_reason = btrim(_reason),
    revision_requested_by = 'admin' where id = c.id;
  update public.bookings set hold_expires_at = public.contract_hold_until(b.start_date, interval '24 hours')
    where id = b.id;
  perform public.log_contract_event(c.id, b.id, _version, 'revision_requested', btrim(_reason));
end; $$;

-- DEMO payment: same signature as before, now gated on the approved contract version.
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

-- Exceptional manual confirmation: Owner only, reason required, audited twice.
create or replace function public.owner_manual_confirm_booking(_booking_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings; cid uuid; cver int;
begin
  perform public.require_owner();
  if length(btrim(coalesce(_reason, ''))) < 10 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร'; end if;
  select * into b from public.bookings where id = _booking_id for update;
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status <> 'pending' then raise exception 'ยืนยันด้วยตนเองได้เฉพาะการจองที่รอดำเนินการ'; end if;
  if exists (select 1 from public.bookings o where o.car_id = b.car_id and o.id <> b.id
      and public.booking_blocks_car(o.status, o.hold_expires_at)
      and daterange(o.start_date, o.end_date, '[]') && daterange(b.start_date, b.end_date, '[]')) then
    raise exception 'รถคันนี้ถูกจองซ้อนในช่วงวันที่นี้แล้ว';
  end if;
  perform set_config('app.manual_confirm', 'on', true);
  update public.bookings set status = 'confirmed' where id = b.id;
  perform set_config('app.manual_confirm', '', true);
  select id, current_version into cid, cver from public.contracts where booking_id = b.id;
  perform public.log_contract_event(cid, b.id, cver, 'manual_confirm', btrim(_reason));
  perform public.log_admin_audit('booking_manual_confirm', b.user_id, null,
    jsonb_build_object('booking_id', b.id, 'booking_code', b.booking_code, 'reason', btrim(_reason)));
end; $$;

-- Tidies expired holds into 'cancelled'. Correctness never depends on it: every check
-- reads hold_expires_at. Safe for any signed-in user (only touches holds already past).
create or replace function public.expire_stale_bookings()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('app.cancel_reason', 'expired', true);
  with x as (
    update public.bookings set status = 'cancelled'
    where status = 'pending' and hold_expires_at <= now() returning 1)
  select count(*) into n from x;
  perform set_config('app.cancel_reason', '', true);
  return n;
end; $$;

-- ---------------------------------------------------------------------
-- 9. Admin management functions (Owner only, except accepting an invitation)
-- ---------------------------------------------------------------------
create or replace function public.validate_admin_permissions(_permissions text[])
returns text[] language plpgsql immutable set search_path = public as $$
declare p text[];
begin
  select coalesce(array_agg(distinct x order by x), '{}') into p from unnest(coalesce(_permissions, '{}')) x;
  if cardinality(p) = 0 then raise exception 'กรุณาเลือกสิทธิ์อย่างน้อย 1 รายการ'; end if;
  if not p <@ public.admin_permission_list() then raise exception 'มีสิทธิ์ที่ไม่รู้จัก'; end if;
  return p;
end; $$;

create or replace function public.owner_create_admin_invitation(_email text, _permissions text[])
returns table (invitation_id uuid, invite_token text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(_email, ''))); perms text[]; tok text; iid uuid; exp timestamptz;
begin
  perform public.require_owner();
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'อีเมลไม่ถูกต้อง'; end if;
  if em like '%@demo.siamwheels.invalid' then raise exception 'บัญชีสาธิตเป็นผู้ดูแลระบบไม่ได้'; end if;
  perms := public.validate_admin_permissions(_permissions);
  if exists (select 1 from public.admin_members m where m.email = em and m.status in ('active','suspended')) then
    raise exception 'อีเมลนี้เป็นผู้ดูแลระบบอยู่แล้ว';
  end if;
  update public.admin_invitations set revoked_at = now(), revoked_by = auth.uid()
    where email = em and accepted_at is null and revoked_at is null;
  -- 244 bits from the database's cryptographic random source; only the hash is stored.
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  exp := now() + interval '72 hours';
  insert into public.admin_invitations (email, token_hash, permissions, invited_by, expires_at)
  values (em, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), perms, auth.uid(), exp)
  returning id into iid;
  perform public.log_admin_audit('invite_created', null, em,
    jsonb_build_object('invitation_id', iid, 'permissions', perms, 'expires_at', exp));
  return query select iid, tok, exp;
end; $$;

create or replace function public.owner_revoke_admin_invitation(_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare em text;
begin
  perform public.require_owner();
  update public.admin_invitations set revoked_at = now(), revoked_by = auth.uid()
    where id = _invitation_id and accepted_at is null and revoked_at is null
    returning email into em;
  if em is null then raise exception 'ไม่พบคำเชิญที่ยังใช้งานได้'; end if;
  perform public.log_admin_audit('invite_revoked', null, em, jsonb_build_object('invitation_id', _invitation_id));
end; $$;

create or replace function public.accept_admin_invitation(_token text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); u auth.users; inv public.admin_invitations;
begin
  if uid is null then raise exception 'กรุณาเข้าสู่ระบบ' using errcode = '42501'; end if;
  select * into u from auth.users where id = uid;
  if coalesce(u.raw_app_meta_data->>'demo', 'false') = 'true'
     or lower(coalesce(u.email, '')) like '%@demo.siamwheels.invalid' then
    raise exception 'บัญชีสาธิตเป็นผู้ดูแลระบบไม่ได้' using errcode = '42501';
  end if;
  select * into inv from public.admin_invitations
    where token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex') for update;
  if inv.id is null or inv.accepted_at is not null or inv.revoked_at is not null
     or inv.expires_at <= now() or inv.email <> lower(coalesce(u.email, '')) then
    raise exception 'คำเชิญไม่ถูกต้อง หมดอายุ หรือไม่ได้ส่งถึงบัญชีนี้';
  end if;
  perform set_config('app.admin_invite', 'on', true);
  insert into public.user_roles (user_id, role) values (uid, 'admin') on conflict (user_id, role) do nothing;
  insert into public.admin_members (user_id, email, status, permissions, invited_by)
  values (uid, inv.email, 'active', inv.permissions, inv.invited_by)
  on conflict (user_id) do update set status = 'active', permissions = excluded.permissions,
    email = excluded.email, invited_by = excluded.invited_by, status_reason = null, updated_at = now()
    where not public.admin_members.is_owner;
  perform set_config('app.admin_invite', '', true);
  update public.admin_invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  perform public.log_admin_audit('invite_accepted', uid, inv.email,
    jsonb_build_object('invitation_id', inv.id, 'permissions', inv.permissions));
end; $$;

create or replace function public.owner_set_admin_permissions(_user_id uuid, _permissions text[])
returns void language plpgsql security definer set search_path = public as $$
declare m public.admin_members; perms text[];
begin
  perform public.require_owner();
  select * into m from public.admin_members where user_id = _user_id for update;
  if m.user_id is null or m.status = 'revoked' then raise exception 'ไม่พบผู้ดูแลระบบ'; end if;
  if m.is_owner then raise exception 'สิทธิ์ของเจ้าของระบบเปลี่ยนไม่ได้'; end if;
  perms := public.validate_admin_permissions(_permissions);
  update public.admin_members set permissions = perms, updated_at = now() where user_id = _user_id;
  perform public.log_admin_audit('permissions_changed', _user_id, m.email,
    jsonb_build_object('from', m.permissions, 'to', perms));
end; $$;

create or replace function public.owner_set_admin_status(_user_id uuid, _status text, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.admin_members; uid uuid; act text;
begin
  uid := public.require_owner();
  if _user_id = uid then raise exception 'เปลี่ยนสถานะบัญชีของตนเองไม่ได้'; end if;
  if length(btrim(coalesce(_reason, ''))) < 5 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'; end if;
  select * into m from public.admin_members where user_id = _user_id for update;
  if m.user_id is null then raise exception 'ไม่พบผู้ดูแลระบบ'; end if;
  if m.is_owner then raise exception 'สถานะของเจ้าของระบบเปลี่ยนไม่ได้'; end if;
  act := case m.status || '>' || coalesce(_status, '')
           when 'active>suspended' then 'admin_suspended'
           when 'suspended>active' then 'admin_reactivated'
           when 'active>revoked' then 'admin_revoked'
           when 'suspended>revoked' then 'admin_revoked' end;
  if act is null then raise exception 'เปลี่ยนสถานะจาก % เป็น % ไม่ได้', m.status, _status; end if;
  update public.admin_members set status = _status, status_reason = btrim(_reason), updated_at = now()
    where user_id = _user_id;
  if _status = 'revoked' then
    delete from public.user_roles where user_id = _user_id and role = 'admin';
  end if;
  perform public.log_admin_audit(act, _user_id, m.email,
    jsonb_build_object('from', m.status, 'to', _status, 'reason', btrim(_reason)));
end; $$;

-- One-time Owner setup. Runs ONLY from the SQL editor / service role (no signed-in user),
-- only while no Owner exists, and only for an existing active admin. Separate approved step.
create or replace function public.bootstrap_owner(_email text)
returns void language plpgsql security definer set search_path = public as $$
declare target uuid; em text := lower(btrim(coalesce(_email, '')));
begin
  if auth.uid() is not null then raise exception 'ใช้ได้จาก SQL editor เท่านั้น' using errcode = '42501'; end if;
  if exists (select 1 from public.admin_members where is_owner) then raise exception 'มีเจ้าของระบบแล้ว'; end if;
  select id into target from auth.users where lower(email) = em;
  if target is null or not public.has_role(target, 'admin') then
    raise exception 'ต้องเป็นผู้ดูแลระบบที่ใช้งานอยู่ก่อน';
  end if;
  update public.admin_members set is_owner = true, status = 'active', updated_at = now() where user_id = target;
  perform public.log_admin_audit('owner_bootstrapped', target, em, '{}'::jsonb);
end; $$;

-- ---------------------------------------------------------------------
-- 10. Permissions
-- ---------------------------------------------------------------------
-- contracts: read through RLS; all writes through the functions above
drop policy if exists "contracts update" on public.contracts;
drop policy if exists "contracts read" on public.contracts;
create policy "contracts read" on public.contracts for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or (user_id = auth.uid() and sent_version is not null));
revoke all on public.contracts from anon;
revoke insert, update, delete, truncate on public.contracts from authenticated;
grant select on public.contracts to authenticated;

alter table public.contract_versions enable row level security;
revoke all on public.contract_versions from anon, authenticated;
grant select on public.contract_versions to authenticated;
grant all on public.contract_versions to service_role;
create policy "contract versions read" on public.contract_versions for select to authenticated
  using (public.has_role(auth.uid(), 'admin')
         or (sent_at is not null and exists (
               select 1 from public.contracts c where c.id = contract_id and c.user_id = auth.uid())));

alter table public.contract_events enable row level security;
revoke all on public.contract_events from anon, authenticated;
grant select on public.contract_events to authenticated;
grant all on public.contract_events to service_role;
create policy "contract events read" on public.contract_events for select to authenticated
  using (public.has_role(auth.uid(), 'admin')
         or (action in ('legacy_import','sent','accepted','revision_requested','approved','paid',
                        'cancelled','expired','manual_confirm')
             and exists (select 1 from public.bookings b where b.id = booking_id and b.user_id = auth.uid())));

-- payments: still read-only for clients (writes only through pay_booking / triggers)
revoke insert, update, delete, truncate on public.payments from anon, authenticated;

-- admin tables: no client writes at all
alter table public.admin_members enable row level security;
revoke all on public.admin_members from anon, authenticated;
grant select on public.admin_members to authenticated;
grant all on public.admin_members to service_role;
create policy "admin members read" on public.admin_members for select to authenticated
  using (user_id = auth.uid() or public.is_owner(auth.uid()));

alter table public.admin_invitations enable row level security;
revoke all on public.admin_invitations from anon, authenticated;
grant select on public.admin_invitations to authenticated;
grant all on public.admin_invitations to service_role;
create policy "admin invitations owner read" on public.admin_invitations for select to authenticated
  using (public.is_owner(auth.uid()));

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;
grant all on public.admin_audit_log to service_role;
create policy "admin audit owner read" on public.admin_audit_log for select to authenticated
  using (public.is_owner(auth.uid()));

-- user_roles: never written by clients (admin comes only from an accepted invitation)
revoke insert, update, delete, truncate on public.user_roles from anon, authenticated;

-- Fine-grained admin permissions on existing tables
drop policy if exists "cars admin write" on public.cars;
create policy "cars admin insert" on public.cars for insert to authenticated
  with check (public.has_admin_permission(auth.uid(), 'fleet_manage'));
create policy "cars admin update" on public.cars for update to authenticated
  using (public.has_admin_permission(auth.uid(), 'fleet_manage'))
  with check (public.has_admin_permission(auth.uid(), 'fleet_manage'));
create policy "cars admin delete" on public.cars for delete to authenticated
  using (public.has_admin_permission(auth.uid(), 'fleet_manage'));

drop policy if exists "maint admin" on public.maintenance;
create policy "maint admin read" on public.maintenance for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
create policy "maint admin insert" on public.maintenance for insert to authenticated
  with check (public.has_admin_permission(auth.uid(), 'fleet_manage'));
create policy "maint admin update" on public.maintenance for update to authenticated
  using (public.has_admin_permission(auth.uid(), 'fleet_manage'))
  with check (public.has_admin_permission(auth.uid(), 'fleet_manage'));
create policy "maint admin delete" on public.maintenance for delete to authenticated
  using (public.has_admin_permission(auth.uid(), 'fleet_manage'));

drop policy if exists "reviews delete admin" on public.reviews;
create policy "reviews delete admin" on public.reviews for delete to authenticated
  using (public.has_admin_permission(auth.uid(), 'reviews_moderate'));

-- Internal helpers: nobody calls these directly through the API
revoke all on function public.contract_hold_until(date, interval) from public, anon, authenticated;
revoke all on function public.booking_blocks_car(public.booking_status, timestamptz) from public, anon, authenticated;
revoke all on function public.require_admin_permission(text) from public, anon, authenticated;
revoke all on function public.require_owner() from public, anon, authenticated;
revoke all on function public.log_admin_audit(text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.assert_booking_open(public.bookings) from public, anon, authenticated;
revoke all on function public.log_contract_event(uuid, uuid, int, text, text, boolean) from public, anon, authenticated;
revoke all on function public.render_contract_terms(text, int, text, text, text, text, text, text, timestamptz, timestamptz, int, numeric, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.write_contract_version(public.contracts, public.bookings, int, boolean, timestamptz, timestamptz, numeric, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.guard_contract_update() from public, anon, authenticated;
revoke all on function public.protect_contract_version() from public, anon, authenticated;
revoke all on function public.append_only() from public, anon, authenticated;
revoke all on function public.guard_admin_role_grant() from public, anon, authenticated;
revoke all on function public.track_admin_member() from public, anon, authenticated;
revoke all on function public.cancel_contract_with_booking() from public, anon, authenticated;
revoke all on function public.validate_admin_permissions(text[]) from public, anon, authenticated;
revoke all on function public.bootstrap_owner(text) from public, anon, authenticated;

-- Used inside RLS policies, so signed-in users must be able to execute them
revoke all on function public.is_owner(uuid) from public, anon;
revoke all on function public.has_admin_permission(uuid, text) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;
grant execute on function public.has_admin_permission(uuid, text) to authenticated;
grant execute on function public.admin_permission_list() to authenticated;

-- API functions: signed-in users only; each checks owner/admin permission/booking owner itself
revoke all on function public.admin_create_contract(uuid, timestamptz, timestamptz, numeric, text, text, text, boolean) from public, anon;
revoke all on function public.admin_update_contract(uuid, timestamptz, timestamptz, numeric, text, text, text, boolean) from public, anon;
revoke all on function public.admin_send_contract(uuid) from public, anon;
revoke all on function public.customer_accept_contract(uuid, int) from public, anon;
revoke all on function public.customer_request_revision(uuid, int, text) from public, anon;
revoke all on function public.admin_approve_contract(uuid, int) from public, anon;
revoke all on function public.admin_request_revision(uuid, int, text) from public, anon;
revoke all on function public.owner_manual_confirm_booking(uuid, text) from public, anon;
revoke all on function public.expire_stale_bookings() from public, anon;
revoke all on function public.pay_booking(uuid, payment_method, text) from public, anon;
revoke all on function public.owner_create_admin_invitation(text, text[]) from public, anon;
revoke all on function public.owner_revoke_admin_invitation(uuid) from public, anon;
revoke all on function public.accept_admin_invitation(text) from public, anon;
revoke all on function public.owner_set_admin_permissions(uuid, text[]) from public, anon;
revoke all on function public.owner_set_admin_status(uuid, text, text) from public, anon;
grant execute on function public.admin_create_contract(uuid, timestamptz, timestamptz, numeric, text, text, text, boolean) to authenticated;
grant execute on function public.admin_update_contract(uuid, timestamptz, timestamptz, numeric, text, text, text, boolean) to authenticated;
grant execute on function public.admin_send_contract(uuid) to authenticated;
grant execute on function public.customer_accept_contract(uuid, int) to authenticated;
grant execute on function public.customer_request_revision(uuid, int, text) to authenticated;
grant execute on function public.admin_approve_contract(uuid, int) to authenticated;
grant execute on function public.admin_request_revision(uuid, int, text) to authenticated;
grant execute on function public.owner_manual_confirm_booking(uuid, text) to authenticated;
grant execute on function public.expire_stale_bookings() to authenticated;
grant execute on function public.pay_booking(uuid, payment_method, text) to authenticated;
grant execute on function public.owner_create_admin_invitation(text, text[]) to authenticated;
grant execute on function public.owner_revoke_admin_invitation(uuid) to authenticated;
grant execute on function public.accept_admin_invitation(text) to authenticated;
grant execute on function public.owner_set_admin_permissions(uuid, text[]) to authenticated;
grant execute on function public.owner_set_admin_status(uuid, text, text) to authenticated;
