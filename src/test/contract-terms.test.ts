import { describe, expect, it } from "vitest";
import {
  ADMIN_CLAUSES_MARKER,
  DEFAULT_ADMIN_CLAUSES,
  buildContractTerms,
  splitContractTerms,
  validateContractEdit,
} from "@/lib/contract-terms";
import { thb } from "@/lib/format";

const BASE = "สัญญาเช่ารถยนต์ Toyota Yaris\n1. ผู้เช่าต้องมีใบอนุญาตขับขี่";
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("Contract editor — admin clauses", () => {
  it("returns no clauses for a contract that was never edited", () => {
    expect(splitContractTerms(BASE)).toEqual({ base: BASE, clauses: null });
  });

  it("round-trips the clause values", () => {
    const clauses = {
      securityDeposit: 8000,
      mileageAllowance: "300 กม./วัน",
      latePenalty: "1,000 บาท / วัน",
    };
    const terms = buildContractTerms(BASE, clauses);
    expect(splitContractTerms(terms)).toEqual({ base: BASE, clauses });
  });

  it("replaces the block on every save instead of keeping the first values", () => {
    const first = buildContractTerms(BASE, DEFAULT_ADMIN_CLAUSES);
    const { base } = splitContractTerms(first);
    const second = buildContractTerms(base, { ...DEFAULT_ADMIN_CLAUSES, securityDeposit: 12000 });

    expect(count(second, ADMIN_CLAUSES_MARKER)).toBe(1);
    expect(second).toContain(thb(12000));
    expect(second).not.toContain(thb(5000));
  });

  it("reads blocks written by the previous version of the editor", () => {
    const legacy = `${BASE}\n\n${ADMIN_CLAUSES_MARKER}\n- เงินประกันความเสียหาย: ${thb(5000)}\n- ข้อกำหนดระยะทาง: ไม่จำกัดระยะทาง\n- ค่าปรับส่งคืนรถล่าช้า: 500 บาท / ชั่วโมง`;
    expect(splitContractTerms(legacy).clauses).toEqual(DEFAULT_ADMIN_CLAUSES);
  });

  it("removes a block pasted into the base text, so it is never duplicated", () => {
    const pasted = buildContractTerms(BASE, DEFAULT_ADMIN_CLAUSES);
    const terms = buildContractTerms(pasted, {
      ...DEFAULT_ADMIN_CLAUSES,
      latePenalty: "800 บาท / ชั่วโมง",
    });
    expect(count(terms, ADMIN_CLAUSES_MARKER)).toBe(1);
    expect(terms).toContain("800 บาท / ชั่วโมง");
  });

  it("handles Windows line endings", () => {
    const terms = buildContractTerms(BASE, DEFAULT_ADMIN_CLAUSES).replace(/\n/g, "\r\n");
    expect(splitContractTerms(terms).clauses).toEqual(DEFAULT_ADMIN_CLAUSES);
  });

  it("validates inputs", () => {
    expect(validateContractEdit(BASE, DEFAULT_ADMIN_CLAUSES)).toBeNull();
    expect(validateContractEdit("  ", DEFAULT_ADMIN_CLAUSES)).not.toBeNull();
    expect(
      validateContractEdit(BASE, { ...DEFAULT_ADMIN_CLAUSES, securityDeposit: -1 }),
    ).not.toBeNull();
    expect(
      validateContractEdit(BASE, { ...DEFAULT_ADMIN_CLAUSES, securityDeposit: Number.NaN }),
    ).not.toBeNull();
    expect(
      validateContractEdit(BASE, { ...DEFAULT_ADMIN_CLAUSES, mileageAllowance: " " }),
    ).not.toBeNull();
    expect(
      validateContractEdit(BASE, { ...DEFAULT_ADMIN_CLAUSES, latePenalty: "" }),
    ).not.toBeNull();
  });
});
