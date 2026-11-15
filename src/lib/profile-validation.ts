import { tr } from "@/lib/i18n";
/**
 * Profile form checks. Mirrors validate_profile_fields() in
 * docs/database/input-validation.sql; the database has the final say.
 */

export type ProfileFields = {
  fullName: string;
  phone: string;
  idCardNo: string;
  licenseNo: string;
};

export type ProfileErrors = Partial<Record<keyof ProfileFields, string>>;

/** Phone as digits only (what signup stores). */
export const normalizePhone = (phone: string) => phone.replace(/\D/g, "");

/** ID card / passport without spaces or dashes, upper case. */
export const normalizeIdCard = (id: string) => id.replace(/[\s-]/g, "").toUpperCase();

/** Licence number without spaces or dashes. */
export const normalizeLicense = (no: string) => no.replace(/[\s-]/g, "");

/** Thai national ID: 13 digits with a valid check digit. */
export function isValidThaiId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

/** Passport number: 6-9 letters/digits with at least one letter. */
export const isPassportNo = (id: string) => /^[A-Z0-9]{6,9}$/.test(id) && !/^\d+$/.test(id);

/** Thai error message per invalid field; empty object when the form can be saved. */
export function profileErrors(f: ProfileFields): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!f.fullName.trim()) errors.fullName = tr("กรุณาระบุชื่อ-นามสกุล", "Please enter your full name");

  const phone = normalizePhone(f.phone);
  if (f.phone.trim() && (/[^\d\s()+-]/.test(f.phone) || !/^0\d{8,9}$/.test(phone)))
    errors.phone = tr("เบอร์โทรศัพท์ไม่ถูกต้อง (ตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0)", "Invalid phone number (9-10 digits starting with 0)");

  const id = normalizeIdCard(f.idCardNo);
  if (!id) errors.idCardNo = tr("กรุณากรอกเลขบัตรประชาชนหรือพาสปอร์ต (ต้องมีจึงจะจองรถได้)", "Please enter your ID card or passport number (required to book)");
  else if (!isValidThaiId(id) && !isPassportNo(id))
    errors.idCardNo = /^\d+$/.test(id)
      ? tr("เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลักที่ถูกต้อง", "The ID card number must be a valid 13-digit number")
      : tr("เลขพาสปอร์ตต้องเป็นตัวอักษรหรือตัวเลข 6-9 ตัว", "The passport number must be 6-9 letters or digits");

  const lic = normalizeLicense(f.licenseNo);
  if (!lic) errors.licenseNo = tr("กรุณากรอกหมายเลขใบอนุญาตขับขี่", "Please enter your driving licence number");
  else if (!/^[A-Za-z0-9]{6,20}$/.test(lic))
    errors.licenseNo = tr("หมายเลขใบอนุญาตขับขี่ไม่ถูกต้อง (ตัวอักษรหรือตัวเลข 6-20 ตัว)", "Invalid driving licence number (6-20 letters or digits)");

  return errors;
}

/** What a customer must have in their profile before booking (docs/database/booking-documents.sql). */
export type BookingDocuments = { id_card_no: string | null; license_no: string | null };

/** Thai names of the missing documents; empty when the customer can book. */
export function missingBookingDocuments(p: BookingDocuments | null | undefined): string[] {
  const missing: string[] = [];
  if (!p?.id_card_no?.trim()) missing.push(tr("เลขบัตรประชาชน / พาสปอร์ต", "ID card / passport number"));
  if (!p?.license_no?.trim()) missing.push(tr("เลขใบอนุญาตขับขี่", "Driving licence number"));
  return missing;
}
