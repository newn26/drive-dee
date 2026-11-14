import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ expire: vi.fn() }));

vi.mock("@/lib/contract-api", () => ({ expireStaleBookings: mocks.expire }));

import {
  PAYMENT_WINDOW_MINUTES,
  cancelExpiredBookings,
  formatCountdown,
  holdSecondsLeft,
  isPaymentExpired,
} from "@/lib/payment-window";

const NOW = new Date("2026-11-11T10:00:00Z").getTime();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const minutesFromNow = (m: number) => new Date(NOW + m * 60_000).toISOString();

describe("booking hold / payment window", () => {
  beforeEach(() => {
    mocks.expire.mockReset();
    mocks.expire.mockResolvedValue(1);
  });

  it("E09 counts down to the server's hold_expires_at", () => {
    expect(PAYMENT_WINDOW_MINUTES).toBe(15);
    const created = minutesAgo(600); // the hold, not the creation time, decides
    expect(holdSecondsLeft({ created_at: created, hold_expires_at: minutesFromNow(15) }, NOW)).toBe(
      15 * 60,
    );
    expect(
      holdSecondsLeft({ created_at: created, hold_expires_at: minutesFromNow(24 * 60) }, NOW),
    ).toBe(24 * 3600);
    expect(holdSecondsLeft({ created_at: created, hold_expires_at: minutesAgo(1) }, NOW)).toBe(0);
  });

  it("falls back to created_at + 15 minutes for rows without a hold (before the migration)", () => {
    expect(holdSecondsLeft({ created_at: minutesAgo(10) }, NOW)).toBe(5 * 60);
    expect(holdSecondsLeft({ created_at: minutesAgo(16), hold_expires_at: null }, NOW)).toBe(0);
  });

  it("only expires pending bookings past their hold", () => {
    expect(
      isPaymentExpired(
        { id: "a", status: "pending", created_at: minutesAgo(1), hold_expires_at: minutesAgo(1) },
        NOW,
      ),
    ).toBe(true);
    expect(
      isPaymentExpired(
        {
          id: "b",
          status: "pending",
          created_at: minutesAgo(600),
          hold_expires_at: minutesFromNow(5),
        },
        NOW,
      ),
    ).toBe(false);
    expect(
      isPaymentExpired(
        { id: "c", status: "confirmed", created_at: minutesAgo(60), hold_expires_at: null },
        NOW,
      ),
    ).toBe(false);
  });

  it("formats the countdown", () => {
    expect(formatCountdown(15 * 60)).toBe("15:00");
    expect(formatCountdown(65)).toBe("01:05");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(23 * 3600 + 5 * 60)).toBe("23 ชม. 05 นาที");
  });

  it("asks the server to cancel expired holds and updates only those rows", async () => {
    const list = [
      { id: "old", status: "pending", created_at: minutesAgo(30), hold_expires_at: minutesAgo(1) },
      {
        id: "new",
        status: "pending",
        created_at: minutesAgo(30),
        hold_expires_at: minutesFromNow(60),
      },
      { id: "paid", status: "confirmed", created_at: minutesAgo(90), hold_expires_at: null },
    ];
    const result = await cancelExpiredBookings(list, NOW);
    expect(mocks.expire).toHaveBeenCalledOnce();
    expect(result.map((b) => b.status)).toEqual(["cancelled", "pending", "confirmed"]);
  });

  it("makes no request when nothing is expired", async () => {
    const list = [
      {
        id: "new",
        status: "pending",
        created_at: minutesAgo(2),
        hold_expires_at: minutesFromNow(5),
      },
    ];
    expect(await cancelExpiredBookings(list, NOW)).toBe(list);
    expect(mocks.expire).not.toHaveBeenCalled();
  });

  it("keeps the list unchanged when the server cancelled nothing or failed", async () => {
    mocks.expire.mockResolvedValue(0);
    const list = [
      { id: "old", status: "pending", created_at: minutesAgo(20), hold_expires_at: minutesAgo(1) },
    ];
    expect(await cancelExpiredBookings(list, NOW)).toBe(list);
  });
});
