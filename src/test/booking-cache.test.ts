import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["eq", "order"]) q[m] = () => q;
    q["then"] = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return q;
  };
  return {
    supabase: {
      from: () => ({
        select: (cols: string) => {
          mocks.select(cols);
          return chain({ data: [{ id: "b1", reviews: [] }], error: null });
        },
      }),
      rpc: mocks.rpc,
    },
  };
});

import {
  BOOKING_RELATED_QUERY_KEYS,
  CUSTOMER_BOOKINGS_SELECT,
  bookedCarIdsQuery,
  bookingReview,
  customerBookingsQuery,
  invalidateBookingData,
} from "@/lib/queries";
import { filterCarsForSearch, isCarBookedInRange } from "@/lib/availability";

const car = (id: string, status: string, price = 1000) => ({
  id,
  brand: "Toyota",
  model: `Model ${id}`,
  category: "eco",
  status,
  price_per_day: price,
});
const cars = [
  car("free", "available", 900),
  car("booked", "available", 1200),
  car("rented", "rented"),
  car("fix", "maintenance"),
];

describe("Customer bookings cache", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses one key and one select (with reviews) for every page", async () => {
    const opts = customerBookingsQuery("user-1");
    expect(opts.queryKey).toEqual(["customer-bookings", "user-1"]);
    expect(CUSTOMER_BOOKINGS_SELECT).toContain("reviews(*)");
    await new QueryClient().fetchQuery(opts);
    expect(mocks.select).toHaveBeenCalledWith(CUSTOMER_BOOKINGS_SELECT);
  });

  it("is the only way /dashboard and /bookings load customer bookings", () => {
    for (const file of ["dashboard.tsx", "bookings.tsx"]) {
      const src = readFileSync(path.resolve(__dirname, "../routes", file), "utf8");
      expect(src).toContain("customerBookingsQuery(");
      // no page-specific booking select that could disagree with the shared one
      expect(src).not.toMatch(/\.select\("\*, cars\(\*\)/);
    }
  });

  it("reads the review whether PostgREST returns an object or an array", () => {
    const review = { id: "r1" } as never;
    expect(bookingReview({ reviews: review })).toBe(review);
    expect(bookingReview({ reviews: [review] })).toBe(review);
    expect(bookingReview({ reviews: [] })).toBeNull();
    expect(bookingReview({ reviews: null })).toBeNull();
  });

  it("invalidates every booking-related cache, including availability", async () => {
    const qc = new QueryClient();
    const keys = [
      ["customer-bookings", "u1"],
      ["booked", "2026-11-20", "2026-11-22"],
      ["cars"],
      ["admin-bookings"],
      ["booking", "b1"],
    ];
    for (const k of keys) qc.setQueryData(k, []);
    await invalidateBookingData(qc);
    for (const k of keys) expect(qc.getQueryState(k)?.isInvalidated).toBe(true);
    expect(BOOKING_RELATED_QUERY_KEYS.map((k) => k[0])).toEqual(
      expect.arrayContaining([
        "customer-bookings",
        "booked",
        "cars",
        "car",
        "booking",
        "payment",
        "contract",
      ]),
    );
  });
});

describe("Availability for selected dates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keys booked-car results by the exact date range and never keeps them fresh", () => {
    const opts = bookedCarIdsQuery("2026-11-20", "2026-11-22");
    expect(opts.queryKey).toEqual(["booked", "2026-11-20", "2026-11-22"]);
    expect(opts.staleTime).toBe(0);
  });

  it("throws on an RPC error instead of reporting no booked cars", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      new QueryClient().fetchQuery({
        ...bookedCarIdsQuery("2026-11-20", "2026-11-22"),
        retry: false,
      }),
    ).rejects.toEqual({
      message: "boom",
    });
  });

  it("shows no cars while availability is loading or failed", () => {
    expect(filterCarsForSearch(cars, {}, { kind: "loading" })).toEqual([]);
    expect(filterCarsForSearch(cars, {}, { kind: "error" })).toEqual([]);
  });

  it("shows only available, unbooked cars once availability is known", () => {
    const list = filterCarsForSearch(cars, {}, { kind: "ready", bookedIds: ["booked"] });
    expect(list.map((c) => c.id)).toEqual(["free"]);
  });

  it("without dates, lists available and rented cars but never maintenance", () => {
    const list = filterCarsForSearch(cars, { sort: "desc" }, { kind: "none" });
    expect(list.map((c) => c.id)).toEqual(["booked", "rented", "free"]);
  });

  it("applies text and category filters", () => {
    expect(
      filterCarsForSearch(cars, { q: "model free" }, { kind: "none" }).map((c) => c.id),
    ).toEqual(["free"]);
    expect(filterCarsForSearch(cars, { category: "suv" }, { kind: "none" })).toEqual([]);
  });

  it("only reports a car as booked from a fetched result", () => {
    expect(isCarBookedInRange("booked", { kind: "ready", bookedIds: ["booked"] })).toBe(true);
    expect(isCarBookedInRange("booked", { kind: "loading" })).toBe(false);
  });
});
