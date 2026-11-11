import { thb } from "@/lib/format";

/** Heading of the admin-managed clause block appended to a contract's terms. */
export const ADMIN_CLAUSES_MARKER = "[ข้อกำหนดเพิ่มเติมจากผู้ดูแลระบบ]";

const LABELS = {
  deposit: "- เงินประกันความเสียหาย:",
  mileage: "- ข้อกำหนดระยะทาง:",
  late: "- ค่าปรับส่งคืนรถล่าช้า:",
} as const;

export type AdminClauses = {
  securityDeposit: number;
  mileageAllowance: string;
  latePenalty: string;
};

export const DEFAULT_ADMIN_CLAUSES: AdminClauses = {
  securityDeposit: 5000,
  mileageAllowance: "ไม่จำกัดระยะทาง",
  latePenalty: "500 บาท / ชั่วโมง",
};

/**
 * Split contract terms into the base text and the admin clause block (if any).
 * Values missing from the block fall back to the defaults.
 */
export function splitContractTerms(terms: string): { base: string; clauses: AdminClauses | null } {
  const idx = terms.indexOf(ADMIN_CLAUSES_MARKER);
  if (idx === -1) return { base: terms.replace(/\s+$/, ""), clauses: null };

  const base = terms.slice(0, idx).replace(/\s+$/, "");
  const clauses: AdminClauses = { ...DEFAULT_ADMIN_CLAUSES };
  for (const raw of terms.slice(idx + ADMIN_CLAUSES_MARKER.length).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith(LABELS.deposit)) {
      const n = Number(line.slice(LABELS.deposit.length).replace(/[^\d.]/g, ""));
      if (Number.isFinite(n)) clauses.securityDeposit = n;
    } else if (line.startsWith(LABELS.mileage)) {
      clauses.mileageAllowance =
        line.slice(LABELS.mileage.length).trim() || clauses.mileageAllowance;
    } else if (line.startsWith(LABELS.late)) {
      clauses.latePenalty = line.slice(LABELS.late.length).trim() || clauses.latePenalty;
    }
  }
  return { base, clauses };
}

/** Thai error message, or null when the inputs are valid. */
export function validateContractEdit(base: string, clauses: AdminClauses): string | null {
  if (!base.trim()) return "กรุณาระบุข้อความสัญญา";
  if (!Number.isFinite(clauses.securityDeposit) || clauses.securityDeposit < 0)
    return "เงินประกันต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป";
  if (!clauses.mileageAllowance.trim()) return "กรุณาระบุข้อกำหนดระยะทาง";
  if (!clauses.latePenalty.trim()) return "กรุณาระบุค่าปรับส่งคืนล่าช้า";
  return null;
}

/**
 * Build the full terms: the base text plus exactly one, up-to-date admin clause block.
 * Any old block (even one pasted into the base text) is replaced, never duplicated.
 */
export function buildContractTerms(base: string, clauses: AdminClauses): string {
  const cleanBase = splitContractTerms(base).base;
  return [
    cleanBase,
    "",
    ADMIN_CLAUSES_MARKER,
    `${LABELS.deposit} ${thb(clauses.securityDeposit)}`,
    `${LABELS.mileage} ${clauses.mileageAllowance.trim()}`,
    `${LABELS.late} ${clauses.latePenalty.trim()}`,
  ].join("\n");
}
