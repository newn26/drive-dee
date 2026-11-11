import { describe, expect, it } from "vitest";
import {
  DEMO_CARD,
  DEMO_DECLINED_CARD,
  demoQrValue,
  isDemoDeclinedCard,
  isValidCardExpiry,
} from "@/lib/demo-payment";

describe("isDemoDeclinedCard", () => {
  it("declines the 0002 test card, formatted or not", () => {
    expect(isDemoDeclinedCard(DEMO_DECLINED_CARD.number)).toBe(true);
    expect(isDemoDeclinedCard("4000000000000002")).toBe(true);
  });

  it("does not decline the success test card", () => {
    expect(isDemoDeclinedCard(DEMO_CARD.number)).toBe(false);
    expect(isDemoDeclinedCard("4242 4242 4242 0020")).toBe(false);
  });
});

describe("demoQrValue", () => {
  it("is clearly marked as a demo and is not a payment link or PromptPay payload", () => {
    const v = demoQrValue("BK2611110ABCD", 2970);
    expect(v).toContain("DEMO");
    expect(v).toContain("BK2611110ABCD");
    expect(v).not.toMatch(/^https?:/);
    expect(v).not.toMatch(/promptpay/i);
    // EMVCo PromptPay payloads start with "000201"
    expect(v.startsWith("000201")).toBe(false);
  });
});

describe("isValidCardExpiry", () => {
  const now = new Date(2026, 10, 11); // 11 Nov 2026

  it("accepts the current month and future dates", () => {
    expect(isValidCardExpiry("11/26", now)).toBe(true);
    expect(isValidCardExpiry("01/27", now)).toBe(true);
    expect(isValidCardExpiry(DEMO_CARD.expiry, now)).toBe(true);
  });

  it("rejects past dates, impossible months and bad formats", () => {
    expect(isValidCardExpiry("10/26", now)).toBe(false);
    expect(isValidCardExpiry("12/25", now)).toBe(false);
    expect(isValidCardExpiry("00/28", now)).toBe(false);
    expect(isValidCardExpiry("13/28", now)).toBe(false);
    expect(isValidCardExpiry("1/28", now)).toBe(false);
    expect(isValidCardExpiry("", now)).toBe(false);
  });
});
