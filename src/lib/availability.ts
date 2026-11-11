type CarLike = {
  id: string;
  brand: string;
  model: string;
  category: string;
  status: string;
  price_per_day: number;
};

export type CarSearch = {
  q?: string | undefined;
  category?: string | undefined;
  sort?: string | undefined;
};

/**
 * Availability for the selected dates:
 * - none: no (valid) date range selected
 * - loading / error: the range is selected but its booked-car list is not known yet
 * - ready: booked-car list fetched for exactly this range
 */
export type Availability =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; bookedIds: readonly string[] };

/**
 * Cars to show on the search page. When dates are selected, a car is shown only
 * once we know it is free for those dates; while that is loading or failed,
 * nothing is shown rather than guessing that every car is free.
 */
export function filterCarsForSearch<T extends CarLike>(
  cars: T[],
  search: CarSearch,
  availability: Availability,
): T[] {
  if (availability.kind === "loading" || availability.kind === "error") return [];

  let list =
    availability.kind === "ready"
      ? cars.filter((c) => c.status === "available" && !availability.bookedIds.includes(c.id))
      : cars.filter((c) => c.status === "available" || c.status === "rented");

  if (search.q) {
    const q = search.q.toLowerCase();
    list = list.filter((c) => `${c.brand} ${c.model}`.toLowerCase().includes(q));
  }
  if (search.category && search.category !== "all")
    list = list.filter((c) => c.category === search.category);
  if (search.sort === "desc") list = [...list].sort((a, b) => b.price_per_day - a.price_per_day);
  return list;
}

/** Whether one car can be booked for the range, per the fetched booked-car list. */
export const isCarBookedInRange = (carId: string, availability: Availability) =>
  availability.kind === "ready" && availability.bookedIds.includes(carId);
