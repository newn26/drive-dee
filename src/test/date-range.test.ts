import { describe, expect, it } from "vitest";

import { adjustEndForStart, rentalDateError } from "@/lib/date-range";

const today = "2026-11-11";

describe("Rental date validation", () => {
  it("accepts a same-day or later return from today onwards", () => {
    expect(rentalDateError("2026-11-11", "2026-11-11", today)).toBeNull();
    expect(rentalDateError("2026-11-12", "2026-11-15", today)).toBeNull();
  });

  it("rejects missing dates", () => {
    expect(rentalDateError("", "2026-11-15", today)).toMatch("กรุณาเลือก");
    expect(rentalDateError("2026-11-12", "", today)).toMatch("กรุณาเลือก");
  });

  it("rejects a pickup date in the past", () => {
    expect(rentalDateError("2026-11-10", "2026-11-15", today)).toMatch("ผ่านมาแล้ว");
  });

  it("rejects a return date before the pickup date", () => {
    expect(rentalDateError("2026-11-15", "2026-11-12", today)).toMatch("ไม่ก่อนวันรับรถ");
  });

  it("moves the return date forward when the pickup date passes it", () => {
    expect(adjustEndForStart("2026-11-20", "2026-11-15")).toBe("2026-11-20");
    expect(adjustEndForStart("2026-11-12", "2026-11-15")).toBe("2026-11-15");
    expect(adjustEndForStart("2026-11-12", "")).toBe("");
  });
});
