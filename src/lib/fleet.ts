/**
 * What is actually happening with the fleet today, from bookings (not only from cars.status,
 * which changes only when an admin moves a booking to "active" or "completed").
 * `today` is a Bangkok calendar date (YYYY-MM-DD).
 */

export type FleetBooking = {
  id: string;
  car_id: string;
  status: string;
  start_date: string;
  end_date: string;
};

export type FleetCar = { id: string; status: string };

/** Paid bookings whose pickup day has come, but the car was never marked as handed over. */
export const overdueHandovers = <B extends FleetBooking>(bookings: B[], today: string) =>
  bookings
    .filter((b) => b.status === "confirmed" && b.start_date <= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

/** Rentals past their return day that were never marked as returned. */
export const overdueReturns = <B extends FleetBooking>(bookings: B[], today: string) =>
  bookings
    .filter((b) => b.status === "active" && b.end_date < today)
    .sort((a, b) => a.end_date.localeCompare(b.end_date));

/** Cars that are with a customer today: picked up (active), or due out today/earlier (confirmed). */
export const carsOutToday = (bookings: FleetBooking[], today: string) =>
  new Set(
    bookings
      .filter(
        (b) =>
          b.status === "active" ||
          (b.status === "confirmed" && b.start_date <= today && today <= b.end_date),
      )
      .map((b) => b.car_id),
  );

/**
 * Fleet counts for the dashboard. Maintenance and "unavailable" (cars.status) win; a car that is
 * with a customer (carsOutToday) counts as rented even if nobody marked the hand-over yet.
 */
export function fleetCounts(cars: FleetCar[], bookings: FleetBooking[], today: string) {
  const out = carsOutToday(bookings, today);
  let rented = 0;
  let maintenance = 0;
  let unavailable = 0;
  for (const c of cars) {
    if (c.status === "maintenance") maintenance++;
    else if (c.status === "unavailable") unavailable++;
    else if (c.status === "rented" || out.has(c.id)) rented++;
  }
  const total = cars.length;
  return {
    total,
    rented,
    maintenance,
    unavailable,
    available: total - rented - maintenance - unavailable,
    utilizationRate: total > 0 ? Math.round((rented / total) * 100) : 0,
  };
}
