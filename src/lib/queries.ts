import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { cancelExpiredBookings } from "@/lib/payment-window";

export const carsQuery = () =>
  queryOptions({
    queryKey: ["cars"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cars").select("*").order("price_per_day");
      if (error) throw error;
      return data;
    },
  });

/** The contract fields the booking lists need (RLS hides unsent drafts from customers). */
export type BookingContract = {
  id: string;
  status: string;
  current_version?: number;
  sent_version?: number | null;
};

/** A customer's booking with its car and (at most one) contract. */
/** kind/deposit come from docs/database/pickup-payment.sql (not in the generated types yet). */
export type CustomerPayment = Tables<"payments"> & {
  kind?: string | null;
  deposit?: number | string | null;
};

export type CustomerBooking = Tables<"bookings"> & {
  cars: Tables<"cars"> | null;
  contracts?: BookingContract | BookingContract[] | null;
  payments?: CustomerPayment[] | null;
};

/** What a cancellation means for the money paid online (mirrors pickup-refund.sql). */
export function cancellationMoney(b: Pick<CustomerBooking, "status" | "payments">) {
  const paid = (b.payments ?? []).filter((p) => p.status === "paid");
  const pickup = paid.find((p) => p.kind === "pickup");
  const kept = paid
    .filter((p) => p.kind !== "pickup")
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);
  // The rest paid online is returned only when the car was never handed over
  const refunded = pickup && b.status !== "active" ? Number(pickup.amount ?? 0) : 0;
  return { kept, refunded };
}


/** The contract attached to a booking, whether PostgREST returned it as an object or an array. */
export const bookingContract = (b: Pick<CustomerBooking, "contracts">): BookingContract | null =>
  Array.isArray(b.contracts) ? (b.contracts[0] ?? null) : (b.contracts ?? null);

/** Normalise a contract for the workflow helpers (missing columns = not migrated yet). */
export const workflowContract = (c: BookingContract | null) =>
  c
    ? {
        status: c.status,
        current_version: c.current_version ?? 1,
        sent_version: c.sent_version ?? null,
      }
    : null;

export const CUSTOMER_BOOKINGS_SELECT = "*, cars(*), contracts(*), payments(*)";

/**
 * One query (one key, one data shape) shared by /dashboard and /bookings.
 * Both pages used the same key with different selects, so one page could show
 * the other page's cached rows.
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
      // Unpaid bookings older than 15 minutes are cancelled here (app-level expiry).
      return cancelExpiredBookings((data ?? []) as unknown as CustomerBooking[]);
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
  ["contract-versions"],
  ["contract-events"],
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
