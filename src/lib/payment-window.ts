import { expireStaleBookings } from "@/lib/contract-api";

/** Payment window after Admin approval. Must match the 15 minutes in admin_approve_contract. */
export const PAYMENT_WINDOW_MINUTES = 15;

type BookingLike = {
  id: string;
  status: string;
  created_at: string;
  hold_expires_at?: string | null;
};

/**
 * When an unpaid booking stops holding the car. The database sets hold_expires_at at every
 * workflow hand-off; rows from before the migration fall back to created_at + 15 minutes.
 */
export function holdDeadline(b: Pick<BookingLike, "created_at" | "hold_expires_at">): number {
  if (b.hold_expires_at) return new Date(b.hold_expires_at).getTime();
  return new Date(b.created_at).getTime() + PAYMENT_WINDOW_MINUTES * 60_000;
}

/** Seconds left on a booking's hold (0 when the time is up). */
export function holdSecondsLeft(
  b: Pick<BookingLike, "created_at" | "hold_expires_at">,
  now: number = Date.now(),
): number {
  return Math.max(0, Math.floor((holdDeadline(b) - now) / 1000));
}

/** A pending booking whose hold has run out. */
export const isPaymentExpired = (b: BookingLike, now: number = Date.now()) =>
  b.status === "pending" && holdSecondsLeft(b, now) === 0;

/** "mm:ss" for a countdown; "h ชม. mm นาที" once it is an hour or more. */
export function formatCountdown(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} ชม. ${String(m).padStart(2, "0")} นาที`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Tidies expired holds in `bookings` into "cancelled" (server-side, expire_stale_bookings) and
 * returns the list with those statuses updated. Correctness does not depend on this: the
 * database ignores expired holds for availability and refuses every step on them.
 * If the call fails, the original list is returned unchanged.
 */
export async function cancelExpiredBookings<T extends BookingLike>(
  bookings: T[],
  now: number = Date.now(),
): Promise<T[]> {
  const expiredIds = bookings.filter((b) => isPaymentExpired(b, now)).map((b) => b.id);
  if (expiredIds.length === 0) return bookings;

  const cancelled = await expireStaleBookings();
  if (cancelled === 0) return bookings;

  return bookings.map((b) => (expiredIds.includes(b.id) ? { ...b, status: "cancelled" } : b));
}
