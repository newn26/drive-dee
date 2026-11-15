import { describe, expect, it } from "vitest";

import { validateCarPrice, validateProfile } from "@/lib/form-validation";

describe("validateCarPrice (B1)", () => {
  it("rejects negative, zero, empty and non-numeric prices", () => {
    expect(validateCarPrice(-100)).not.toBeNull();
    expect(validateCarPrice(0)).not.toBeNull();
    expect(validateCarPrice("")).not.toBeNull();
    expect(validateCarPrice("abc")).not.toBeNull();
    expect(validateCarPrice(Number.NaN)).not.toBeNull();
    expect(validateCarPrice(Number.POSITIVE_INFINITY)).not.toBeNull();
  });

  it("rejects prices the numeric(10,2) column cannot hold", () => {
    expect(validateCarPrice(100_000_000)).not.toBeNull();
    expect(validateCarPrice(1500.555)).not.toBeNull();
  });

  it("accepts normal daily prices", () => {
    expect(validateCarPrice(1500)).toBeNull();
    expect(validateCarPrice("990")).toBeNull();
    expect(validateCarPrice(1299.5)).toBeNull();
    expect(validateCarPrice(19.99)).toBeNull();
    expect(validateCarPrice(1234.56)).toBeNull();
  });
});

const valid = {
  fullName: "สมชาย มั่นคง",
  phone: "0812345678",
  idCardNo: "1103700012345",
  licenseNo: "12345678",
};

describe("validateProfile", () => {
  it("accepts a complete, well-formed profile", () => {
    expect(validateProfile(valid)).toEqual({});
  });

  it("requires the name", () => {
    expect(validateProfile({ ...valid, fullName: "   " }).fullName).toBeDefined();
  });

  it("B2: requires the driver's license number", () => {
    expect(validateProfile({ ...valid, licenseNo: "" }).licenseNo).toBeDefined();
    expect(validateProfile({ ...valid, licenseNo: "   " }).licenseNo).toBeDefined();
  });

  it("B3: rejects a phone number that is not a Thai number", () => {
    expect(validateProfile({ ...valid, phone: "abc12" }).phone).toBeDefined();
    expect(validateProfile({ ...valid, phone: "12345" }).phone).toBeDefined();
    expect(validateProfile({ ...valid, phone: "08123456789" }).phone).toBeDefined();
  });

  it("accepts mobile and landline numbers, with or without separators", () => {
    for (const phone of ["0812345678", "081-234-5678", "081 234 5678", "021234567", "+66812345678", ""]) {
      expect(validateProfile({ ...valid, phone }).phone).toBeUndefined();
    }
  });

  it("B4: rejects an ID that is neither a 13-digit Thai ID nor a passport number", () => {
    expect(validateProfile({ ...valid, idCardNo: "123" }).idCardNo).toBeDefined();
    expect(validateProfile({ ...valid, idCardNo: "123456789012" }).idCardNo).toBeDefined();
    expect(validateProfile({ ...valid, idCardNo: "12345678901234" }).idCardNo).toBeDefined();
    expect(validateProfile({ ...valid, idCardNo: "ab!@#" }).idCardNo).toBeDefined();
  });

  it("accepts a Thai ID (with dashes) or a passport number, and allows it to be blank", () => {
    for (const idCardNo of ["1103700012345", "1-1037-00012-34-5", "AA1234567", "x1234567", ""]) {
      expect(validateProfile({ ...valid, idCardNo }).idCardNo).toBeUndefined();
    }
  });
});
