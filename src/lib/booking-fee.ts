/**
 * Booking fee and pickup charges, for display. Mirrors booking_fee() and pay_booking() in
 * docs/database/booking-fee-flow.sql; the database charges the fee, nothing here does.
 */

/** Paid online at booking, whatever the length; not refunded on cancellation. */
export const BOOKING_FEE = 1000;

export type RentalCharges = {
  /** price per day × days */
  rent: number;
  /** Insurance deposit = rent; paid at pickup, returned when the car comes back. */
  insurance: number;
  fee: number;
  /** rent + insurance − booking fee */
  dueAtPickup: number;
};

export function rentalCharges(rent: number): RentalCharges {
  const r = Number(rent) || 0;
  return { rent: r, insurance: r, fee: BOOKING_FEE, dueAtPickup: Math.max(r * 2 - BOOKING_FEE, 0) };
}
