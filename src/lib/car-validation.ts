import { tr } from "@/lib/i18n";
/**
 * Admin car form checks. Mirrors the CHECK constraints on public.cars
 * (docs/database/input-validation.sql); the database has the final say.
 */
export const CAR_LIMITS = {
  minYear: 1990,
  maxYear: 2100,
  minSeats: 1,
  maxSeats: 15,
} as const;

export type CarNumbers = { price_per_day: number; seats: number; mileage: number; year: number };

/** Thai error message, or null when the numbers are valid. */
export function carFormError(c: CarNumbers): string | null {
  if (!Number.isFinite(c.price_per_day) || c.price_per_day <= 0)
    return tr("ราคาต่อวันต้องมากกว่า 0 บาท", "The price per day must be more than 0 THB");
  if (!Number.isInteger(c.seats) || c.seats < CAR_LIMITS.minSeats || c.seats > CAR_LIMITS.maxSeats)
    return tr(
      `จำนวนที่นั่งต้องอยู่ระหว่าง ${CAR_LIMITS.minSeats}-${CAR_LIMITS.maxSeats}`,
      `Seats must be between ${CAR_LIMITS.minSeats} and ${CAR_LIMITS.maxSeats}`,
    );
  if (!Number.isFinite(c.mileage) || c.mileage < 0)
    return tr("เลขไมล์ต้องไม่ติดลบ", "Mileage cannot be negative");
  if (!Number.isInteger(c.year) || c.year < CAR_LIMITS.minYear || c.year > CAR_LIMITS.maxYear)
    return tr(
      `ปีรถต้องอยู่ระหว่าง ${CAR_LIMITS.minYear}-${CAR_LIMITS.maxYear}`,
      `The year must be between ${CAR_LIMITS.minYear} and ${CAR_LIMITS.maxYear}`,
    );
  return null;
}
