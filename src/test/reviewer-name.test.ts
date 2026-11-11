import { describe, expect, it } from "vitest";

import { reviewerDisplayName } from "@/lib/reviewer-name";

describe("reviewerDisplayName", () => {
  it("shows the first name and the last-name initial only", () => {
    expect(reviewerDisplayName("สมชาย มั่นคง")).toBe("สมชาย ม.");
    expect(reviewerDisplayName("John Smith")).toBe("John S.");
    expect(reviewerDisplayName("anna van der berg")).toBe("anna B.");
  });

  it("uses the consonant, not a leading Thai vowel, as the initial", () => {
    expect(reviewerDisplayName("วิชัย เจริญสุข")).toBe("วิชัย จ.");
    expect(reviewerDisplayName("นภา ใจดี")).toBe("นภา จ.");
  });

  it("keeps the Demo Customer label", () => {
    expect(reviewerDisplayName("[DEMO] คุณสมมติ ใจดี")).toBe("[DEMO] คุณสมมติ จ.");
  });

  it("handles single names, extra spaces and missing names", () => {
    expect(reviewerDisplayName("  Madonna  ")).toBe("Madonna");
    expect(reviewerDisplayName("สมชาย    มั่นคง ")).toBe("สมชาย ม.");
    expect(reviewerDisplayName("")).toBe("ลูกค้า");
    expect(reviewerDisplayName(undefined)).toBe("ลูกค้า");
    expect(reviewerDisplayName("[DEMO]")).toBe("[DEMO] ลูกค้า");
  });

  it("never stores the full last name and stays short", () => {
    expect(reviewerDisplayName("สมชาย มั่นคง")).not.toContain("มั่นคง");
    expect(Array.from(reviewerDisplayName("ก".repeat(80))).length).toBeLessThanOrEqual(40);
  });
});
