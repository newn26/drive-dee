import { tr } from "@/lib/i18n";
/**
 * Thai error for a pickup/return date pair (YYYY-MM-DD strings), or null when valid.
 * Used by every rental date picker so they all reject the same input.
 */
export function rentalDateError(start: string, end: string, today: string): string | null {
  if (!start || !end) return tr("กรุณาเลือกวันรับรถและวันคืนรถ", "Please choose the pickup and return dates");
  if (start < today) return tr("วันรับรถต้องไม่เป็นวันที่ผ่านมาแล้ว", "The pickup date cannot be in the past");
  if (end < start) return tr("วันคืนรถต้องไม่ก่อนวันรับรถ", "The return date cannot be before the pickup date");
  return null;
}

/** When the pickup date moves past the return date, push the return date along with it. */
export const adjustEndForStart = (start: string, end: string) => (end && end < start ? start : end);
