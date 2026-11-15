export const MIN_PASSWORD_LENGTH = 6;

/** Thai error message, or null when the new password is acceptable. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `รหัสผ่านต้องมีความยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  if (password !== confirm) return "รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน";
  return null;
}

/** Thai error message for a signed-in password change, or null when it can be sent. */
export function validatePasswordChange(
  current: string,
  password: string,
  confirm: string,
): string | null {
  if (!current) return "กรุณากรอกรหัสผ่านปัจจุบัน";
  const problem = validateNewPassword(password, confirm);
  if (problem) return problem;
  if (password === current) return "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน";
  return null;
}

/**
 * Error that Supabase puts in the reset link's redirect URL (hash or query),
 * e.g. when the link has expired or was already used. Null when there is none.
 */
export function recoveryLinkError(hash: string, search: string): string | null {
  for (const raw of [hash.replace(/^#/, ""), search.replace(/^\?/, "")]) {
    const params = new URLSearchParams(raw);
    const code = params.get("error_code") ?? params.get("error");
    if (!code && !params.get("error_description")) continue;
    if (code === "otp_expired")
      return "ลิงก์รีเซ็ตรหัสผ่านหมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่";
    return "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง กรุณาขอลิงก์ใหม่";
  }
  return null;
}
