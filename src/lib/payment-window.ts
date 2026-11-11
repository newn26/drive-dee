import { supabase } from "@/integrations/supabase/client";

/** Unpaid bookings hold the car for this long. Must match the 15 minutes used in the database. */
export const PAYMENT_WINDOW_MINUTES = 15;

type BookingLike = { id: string; status: string; created_at: string };

/** Seconds left to pay a booking created at `createdAt` (0 when the time is up). */
export function paymentSecondsLeft(createdAt: string, now: number = Date.now()): number {
  const deadline = new Date(createdAt).getTime() + PAYMENT_WINDOW_MINUTES * 60_000;
  return Math.max(0, Math.floor((deadline - now) / 1000));
}

/** A pending booking whose payment time has run out. */
export const isPaymentExpired = (b: BookingLike, now: number = Date.now()) =>
  b.status === "pending" && paymentSecondsLeft(b.created_at, now) === 0;

/** "mm:ss" for a countdown. */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Cancels the expired unpaid bookings in `bookings` and returns the list with their
 * status updated. Simple app-level expiry for the demo (no scheduled job needed).
 * If the update fails, the original list is returned unchanged.
 */
export async function cancelExpiredBookings<T extends BookingLike>(
  bookings: T[],
  now: number = Date.now(),
): Promise<T[]> {
  const expiredIds = bookings.filter((b) => isPaymentExpired(b, now)).map((b) => b.id);
  if (expiredIds.length === 0) return bookings;

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .in("id", expiredIds)
    .eq("status", "pending");
  if (error) return bookings;

  return bookings.map((b) => (expiredIds.includes(b.id) ? { ...b, status: "cancelled" } : b));
}
