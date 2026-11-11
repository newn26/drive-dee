/**
 * Thai error for a pickup/return date pair (YYYY-MM-DD strings), or null when valid.
 * Used by every rental date picker so they all reject the same input.
 */
export function rentalDateError(start: string, end: string, today: string): string | null {
  if (!start || !end) return "กรุณาเลือกวันรับรถและวันคืนรถ";
  if (start < today) return "วันรับรถต้องไม่เป็นวันที่ผ่านมาแล้ว";
  if (end < start) return "วันคืนรถต้องไม่ก่อนวันรับรถ";
  return null;
}

/** When the pickup date moves past the return date, push the return date along with it. */
export const adjustEndForStart = (start: string, end: string) => (end && end < start ? start : end);
