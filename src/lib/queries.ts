import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export const carsQuery = () =>
  queryOptions({
    queryKey: ["cars"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cars").select("*").order("price_per_day");
      if (error) throw error;
      return data;
    },
  });

export const ratingsQuery = () =>
  queryOptions({
    queryKey: ["ratings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reviews").select("car_id, rating");
      if (error) throw error;
      const map: Record<string, { avg: number; count: number }> = {};
      for (const r of data) {
        const m = (map[r.car_id] ??= { avg: 0, count: 0 });
        m.avg = (m.avg * m.count + r.rating) / (m.count + 1);
        m.count++;
      }
      return map;
    },
  });

/** A customer's booking with its car and (at most one) review. */
export type CustomerBooking = Tables<"bookings"> & {
  cars: Tables<"cars"> | null;
  reviews: Tables<"reviews"> | Tables<"reviews">[] | null;
};

/** The review attached to a booking, whether PostgREST returned it as an object or an array. */
export const bookingReview = (b: Pick<CustomerBooking, "reviews">): Tables<"reviews"> | null =>
  Array.isArray(b.reviews) ? (b.reviews[0] ?? null) : (b.reviews ?? null);

export const CUSTOMER_BOOKINGS_SELECT = "*, cars(*), reviews(*)";

/**
 * One query (one key, one data shape) shared by /dashboard and /bookings.
 * Both pages used the same key with different selects, so one page could show
 * the other page's cached rows (without reviews).
 */
export const customerBookingsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["customer-bookings", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(CUSTOMER_BOOKINGS_SELECT)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CustomerBooking[];
    },
  });

/** Car ids that cannot be booked in the date range. Errors are thrown, never treated as "nothing booked". */
export const bookedCarIdsQuery = (start: string, end: string) =>
  queryOptions({
    queryKey: ["booked", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("booked_car_ids", { _start: start, _end: end });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    staleTime: 0,
  });

/** Every cached query whose data depends on bookings, payments or car availability. */
export const BOOKING_RELATED_QUERY_KEYS = [
  ["customer-bookings"],
  ["booking"],
  ["payment"],
  ["contract"],
  ["booked"],
  ["cars"],
  ["car"],
  ["admin-bookings"],
  ["admin-cars"],
  ["admin-payments"],
  ["admin-contracts"],
] as const;

/** Call after any booking, payment, cancellation or status change. */
export const invalidateBookingData = (qc: QueryClient) =>
  Promise.all(
    BOOKING_RELATED_QUERY_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })),
  );
