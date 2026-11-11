import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ update: vi.fn(), inIds: vi.fn(), error: null as unknown }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => {
        mocks.update(values);
        return {
          in: (_col: string, ids: string[]) => {
            mocks.inIds(ids);
            return { eq: () => Promise.resolve({ error: mocks.error }) };
          },
        };
      },
    }),
  },
}));

import {
  PAYMENT_WINDOW_MINUTES,
  cancelExpiredBookings,
  formatCountdown,
  isPaymentExpired,
  paymentSecondsLeft,
} from "@/lib/payment-window";

const NOW = new Date("2026-11-11T10:00:00Z").getTime();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("payment window", () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.inIds.mockReset();
    mocks.error = null;
  });

  it("is 15 minutes", () => {
    expect(PAYMENT_WINDOW_MINUTES).toBe(15);
    expect(paymentSecondsLeft(minutesAgo(0), NOW)).toBe(15 * 60);
    expect(paymentSecondsLeft(minutesAgo(10), NOW)).toBe(5 * 60);
    expect(paymentSecondsLeft(minutesAgo(15), NOW)).toBe(0);
    expect(paymentSecondsLeft(minutesAgo(60), NOW)).toBe(0);
  });

  it("only expires pending bookings past the deadline", () => {
    expect(isPaymentExpired({ id: "a", status: "pending", created_at: minutesAgo(16) }, NOW)).toBe(
      true,
    );
    expect(isPaymentExpired({ id: "b", status: "pending", created_at: minutesAgo(5) }, NOW)).toBe(
      false,
    );
    expect(
      isPaymentExpired({ id: "c", status: "confirmed", created_at: minutesAgo(60) }, NOW),
    ).toBe(false);
  });

  it("formats the countdown as mm:ss", () => {
    expect(formatCountdown(15 * 60)).toBe("15:00");
    expect(formatCountdown(65)).toBe("01:05");
    expect(formatCountdown(0)).toBe("00:00");
  });

  it("cancels only expired pending bookings", async () => {
    const list = [
      { id: "old", status: "pending", created_at: minutesAgo(20) },
      { id: "new", status: "pending", created_at: minutesAgo(2) },
      { id: "paid", status: "confirmed", created_at: minutesAgo(90) },
    ];
    const result = await cancelExpiredBookings(list, NOW);
    expect(mocks.update).toHaveBeenCalledWith({ status: "cancelled" });
    expect(mocks.inIds).toHaveBeenCalledWith(["old"]);
    expect(result.map((b) => b.status)).toEqual(["cancelled", "pending", "confirmed"]);
  });

  it("makes no request when nothing is expired", async () => {
    const list = [{ id: "new", status: "pending", created_at: minutesAgo(2) }];
    expect(await cancelExpiredBookings(list, NOW)).toBe(list);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps the list unchanged when the update fails", async () => {
    mocks.error = { message: "denied" };
    const list = [{ id: "old", status: "pending", created_at: minutesAgo(20) }];
    expect(await cancelExpiredBookings(list, NOW)).toBe(list);
  });
});
