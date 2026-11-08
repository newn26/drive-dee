
create or replace function public.booked_car_ids(_start date, _end date)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct car_id from public.bookings
  where status in ('pending','confirmed','active')
    and daterange(start_date, end_date, '[]') && daterange(_start, _end, '[]')
$$;
grant execute on function public.booked_car_ids(date, date) to anon, authenticated;
