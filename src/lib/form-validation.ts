/** Largest value the cars.price_per_day numeric(10,2) column can hold. */
const MAX_PRICE_PER_DAY = 99_999_999.99;

/**
 * Daily rental price entered by an admin. Returns a Thai error message, or null when valid.
 * The price is shown to customers as-is, so it must be a positive amount in baht (at most 2 decimals).
 */
export function validateCarPrice(value: number | string): string | null {
  const price = typeof value === "string" ? (value.trim() === "" ? Number.NaN : Number(value)) : value;
  if (!Number.isFinite(price)) return "กรุณาระบุราคาต่อวันเป็นตัวเลข";
  if (price <= 0) return "ราคาต่อวันต้องมากกว่า 0 บาท";
  if (price > MAX_PRICE_PER_DAY) return "ราคาต่อวันสูงเกินไป";
  // Tolerance because e.g. 19.99 * 100 === 1998.9999999999998 in floating point
  if (Math.abs(Math.round(price * 100) - price * 100) > 1e-6) return "ราคาต่อวันระบุทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
  return null;
}

export type ProfileInput = {
  fullName: string;
  phone: string;
  idCardNo: string;
  licenseNo: string;
};

export type ProfileErrors = Partial<Record<keyof ProfileInput, string>>;

/** Removes the spaces and dashes people type to group digits ("081-234-5678"). */
export function stripSeparators(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** Thai mobile (10 digits) or landline (9 digits) starting with 0, or the same with +66 instead of 0. */
const THAI_PHONE = /^(?:0\d{8,9}|\+66\d{8,9})$/;
const THAI_ID = /^\d{13}$/;
/** Passport numbers are 6–9 letters/digits and contain at least one letter. */
const PASSPORT = /^(?=.*[A-Z])[A-Z0-9]{6,9}$/;

/**
 * Checks the profile form. Name and driver's license are required (the license is needed to rent);
 * phone and ID are optional but must be well-formed when filled in.
 * Returns one Thai message per invalid field; an empty object means the form is valid.
 */
export function validateProfile(input: ProfileInput): ProfileErrors {
  const errors: ProfileErrors = {};

  if (!input.fullName.trim()) errors.fullName = "กรุณาระบุชื่อ-นามสกุล";

  if (!input.licenseNo.trim()) errors.licenseNo = "กรุณาระบุหมายเลขใบอนุญาตขับขี่";

  const phone = stripSeparators(input.phone);
  if (phone && !THAI_PHONE.test(phone)) {
    errors.phone = "เบอร์โทรศัพท์ไม่ถูกต้อง (ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0 เช่น 0812345678)";
  }

  const id = stripSeparators(input.idCardNo).toUpperCase();
  if (id && !THAI_ID.test(id) && !PASSPORT.test(id)) {
    errors.idCardNo = /^\d+$/.test(id)
      ? "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก"
      : "เลขบัตรประชาชน (13 หลัก) หรือเลขพาสปอร์ต (6–9 ตัวอักษร/ตัวเลข) ไม่ถูกต้อง";
  }

  return errors;
}
