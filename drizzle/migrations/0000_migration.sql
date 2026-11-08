
create type public.app_role as enum ('admin','customer');
create type public.car_status as enum ('available','rented','maintenance','unavailable');
create type public.booking_status as enum ('pending','confirmed','active','completed','cancelled');
create type public.payment_method as enum ('qr','card');
create type public.maintenance_status as enum ('scheduled','in_progress','completed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text default '',
  address text default '',
  license_no text default '',
  id_card_no text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique(user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;

create policy "own roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), coalesce(new.raw_user_meta_data->>'phone',''));
  if not exists (select 1 from public.user_roles where role='admin') then
    insert into public.user_roles(user_id, role) values (new.id, 'admin');
  end if;
  insert into public.user_roles(user_id, role) values (new.id, 'customer');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.cars (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  year int not null,
  category text not null default 'sedan',
  seats int not null default 5,
  transmission text not null default 'อัตโนมัติ',
  fuel text not null default 'เบนซิน',
  plate_no text not null unique,
  price_per_day numeric(10,2) not null,
  image_url text,
  description text default '',
  status car_status not null default 'available',
  mileage int not null default 0,
  created_at timestamptz not null default now()
);
grant select on public.cars to anon, authenticated;
grant insert, update, delete on public.cars to authenticated;
grant all on public.cars to service_role;
alter table public.cars enable row level security;
create policy "cars public read" on public.cars for select to anon, authenticated using (true);
create policy "cars admin write" on public.cars for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text not null unique default ('BK' || to_char(now() at time zone 'Asia/Bangkok','YYMMDD') || upper(substr(md5(random()::text),1,5))),
  user_id uuid not null,
  car_id uuid not null references public.cars(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  pickup_location text not null default 'สาขากรุงเทพฯ',
  days int not null,
  total_amount numeric(10,2) not null,
  status booking_status not null default 'pending',
  notes text default '',
  created_at timestamptz not null default now()
);
grant select, insert, update on public.bookings to authenticated;
grant all on public.bookings to service_role;
alter table public.bookings enable row level security;
create policy "bookings read" on public.bookings for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "bookings insert" on public.bookings for insert to authenticated with check (user_id = auth.uid() and status='pending');
create policy "bookings update" on public.bookings for update to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create or replace function public.validate_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare p numeric;
begin
  if new.end_date < new.start_date then raise exception 'วันคืนรถต้องไม่ก่อนวันรับรถ'; end if;
  if tg_op = 'INSERT' then
    if new.start_date < (now() at time zone 'Asia/Bangkok')::date then raise exception 'ไม่สามารถจองย้อนหลังได้'; end if;
    select price_per_day into p from public.cars where id = new.car_id and status <> 'unavailable';
    if p is null then raise exception 'รถคันนี้ไม่พร้อมให้เช่า'; end if;
    if exists (select 1 from public.bookings b where b.car_id = new.car_id and b.status in ('pending','confirmed','active')
      and daterange(b.start_date, b.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
      raise exception 'รถคันนี้ถูกจองในช่วงวันที่เลือกแล้ว';
    end if;
    new.days := (new.end_date - new.start_date) + 1;
    new.total_amount := p * new.days;
  end if;
  if tg_op = 'UPDATE' and not public.has_role(auth.uid(),'admin') then
    if new.status <> old.status and not (old.status in ('pending','confirmed') and new.status = 'cancelled') then
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
    end if;
    new.total_amount := old.total_amount; new.start_date := old.start_date; new.end_date := old.end_date; new.car_id := old.car_id;
  end if;
  return new;
end; $$;
create trigger trg_validate_booking before insert or update on public.bookings for each row execute function public.validate_booking();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  user_id uuid not null,
  method payment_method not null,
  amount numeric(10,2) not null,
  status text not null default 'paid',
  reference text not null default upper(substr(md5(random()::text),1,10)),
  card_last4 text,
  paid_at timestamptz not null default now()
);
grant select on public.payments to authenticated;
grant all on public.payments to service_role;
alter table public.payments enable row level security;
create policy "payments read" on public.payments for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_no text not null unique default ('CT' || to_char(now() at time zone 'Asia/Bangkok','YYMMDD') || upper(substr(md5(random()::text),1,5))),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  user_id uuid not null,
  terms text not null,
  status text not null default 'active',
  customer_accepted_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, update on public.contracts to authenticated;
grant all on public.contracts to service_role;
alter table public.contracts enable row level security;
create policy "contracts read" on public.contracts for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "contracts update" on public.contracts for update to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

-- Demo payment: marks booking confirmed and issues contract
create or replace function public.pay_booking(_booking_id uuid, _method payment_method, _card_last4 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.bookings; c public.cars; pid uuid;
begin
  select * into b from public.bookings where id = _booking_id and user_id = auth.uid();
  if b.id is null then raise exception 'ไม่พบการจอง'; end if;
  if b.status <> 'pending' then raise exception 'การจองนี้ชำระเงินแล้วหรือถูกยกเลิก'; end if;
  select * into c from public.cars where id = b.car_id;
  insert into public.payments(booking_id,user_id,method,amount,card_last4) values (b.id, b.user_id, _method, b.total_amount, _card_last4) returning id into pid;
  update public.bookings set status='confirmed' where id = b.id;
  insert into public.contracts(booking_id,user_id,terms) values (b.id, b.user_id,
    'สัญญาเช่ารถยนต์ ' || c.brand || ' ' || c.model || ' ทะเบียน ' || c.plate_no || E'\n' ||
    'ระยะเวลาเช่า: ' || to_char(b.start_date,'DD/MM/YYYY') || ' ถึง ' || to_char(b.end_date,'DD/MM/YYYY') || ' (' || b.days || ' วัน)' || E'\n' ||
    'ค่าเช่ารวม: ' || to_char(b.total_amount,'FM999,999,990.00') || ' บาท' || E'\n\n' ||
    '1. ผู้เช่าต้องมีใบอนุญาตขับขี่ที่ยังไม่หมดอายุ' || E'\n' ||
    '2. ผู้เช่าต้องคืนรถตามวันและเวลาที่กำหนด หากคืนล่าช้าคิดค่าปรับวันละ 1 เท่าของค่าเช่ารายวัน' || E'\n' ||
    '3. ผู้เช่าต้องคืนรถพร้อมน้ำมันในระดับเดียวกับวันรับรถ' || E'\n' ||
    '4. ห้ามนำรถไปใช้ในทางผิดกฎหมาย หรือให้บุคคลอื่นเช่าช่วง' || E'\n' ||
    '5. กรณีเกิดอุบัติเหตุ ผู้เช่าต้องแจ้งบริษัทภายใน 24 ชั่วโมง');
  return pid;
end; $$;
grant execute on function public.pay_booking(uuid, payment_method, text) to authenticated;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  car_id uuid not null references public.cars(id) on delete cascade,
  user_id uuid not null,
  reviewer_name text not null default 'ลูกค้า',
  rating int not null check (rating between 1 and 5),
  comment text default '',
  created_at timestamptz not null default now()
);
grant select on public.reviews to anon, authenticated;
grant insert, delete on public.reviews to authenticated;
grant all on public.reviews to service_role;
alter table public.reviews enable row level security;
create policy "reviews public" on public.reviews for select to anon, authenticated using (true);
create policy "reviews insert" on public.reviews for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.bookings b where b.id = booking_id and b.user_id = auth.uid() and b.car_id = reviews.car_id and b.status in ('confirmed','active','completed')));
create policy "reviews delete admin" on public.reviews for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.maintenance (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  title text not null,
  description text default '',
  scheduled_date date not null,
  completed_date date,
  cost numeric(10,2) not null default 0,
  status maintenance_status not null default 'scheduled',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.maintenance to authenticated;
grant all on public.maintenance to service_role;
alter table public.maintenance enable row level security;
create policy "maint admin" on public.maintenance for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

insert into public.cars(brand,model,year,category,seats,transmission,fuel,plate_no,price_per_day,image_url,description,mileage) values
('Toyota','Yaris Ativ',2024,'eco',5,'อัตโนมัติ','เบนซิน','1กข 1234',990,'eco','รถเก๋งประหยัดน้ำมัน เหมาะสำหรับขับในเมือง',12000),
('Honda','City e:HEV',2024,'eco',5,'อัตโนมัติ','ไฮบริด','2กข 5678',1290,'eco','ไฮบริดประหยัดสุด ขับนุ่มเงียบ',8000),
('Toyota','Camry HEV',2023,'sedan',5,'อัตโนมัติ','ไฮบริด','3กค 2468',2490,'sedan','ซีดานหรู กว้างขวาง เหมาะกับการเดินทางเชิงธุรกิจ',21000),
('Honda','Accord',2023,'sedan',5,'อัตโนมัติ','ไฮบริด','4กค 1357',2290,'sedan','นั่งสบาย ระบบความปลอดภัยครบ',18000),
('Toyota','Fortuner',2024,'suv',7,'อัตโนมัติ','ดีเซล','5ขค 9999',2890,'suv','SUV 7 ที่นั่ง ลุยได้ทุกเส้นทาง',15000),
('Mazda','CX-5',2023,'suv',5,'อัตโนมัติ','เบนซิน','6ขง 4321',2190,'suv','ดีไซน์สวย ขับสนุก',24000),
('Toyota','Commuter',2023,'van',12,'อัตโนมัติ','ดีเซล','7ขจ 8888',3490,'van','รถตู้ 12 ที่นั่ง เหมาะสำหรับครอบครัวและกรุ๊ปทัวร์',40000),
('BYD','Atto 3',2024,'ev',5,'อัตโนมัติ','ไฟฟ้า','8ขฉ 2024',1890,'ev','รถยนต์ไฟฟ้า 100% วิ่งได้ไกล 410 กม.',6000);
