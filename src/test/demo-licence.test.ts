import { describe, expect, it } from "vitest";

import { demoLicenceNo } from "@/lib/demo-licence";

describe("demoLicenceNo", () => {
  it("is a clearly fake 'DEMO-' number with 8 digits", () => {
    expect(demoLicenceNo(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBe("DEMO-01234567");
    expect(demoLicenceNo(new Uint8Array([255, 19, 200, 9, 10, 11, 99, 42]))).toMatch(/^DEMO-\d{8}$/);
  });

  it("pads short input instead of producing a shorter number", () => {
    expect(demoLicenceNo(new Uint8Array([7]))).toMatch(/^DEMO-\d{8}$/);
  });
});
