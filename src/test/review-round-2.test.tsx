/**
 * Fixes from the second live walkthrough: pickup-day status moves, kept booking fees in revenue,
 * stock car photos labelled, review stars named, work queue placeholder while loading.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  };
});

import { bookingMovesOn, defaultBookingMove } from "@/lib/contract-workflow";
import { computeReport, isKeptBookingFee, bookingStatusMap } from "@/lib/reports";
import { carImage, isStockCarImage } from "@/lib/car-images";
import { CarCard } from "@/components/car-card";
import { ContractWorkQueue } from "@/components/admin/contracts-panel";
import type { Tables } from "@/integrations/supabase/types";

describe("1. handing over / taking back only from the pickup day", () => {
  const b = { status: "confirmed", start_date: "2026-11-28" };
  it("before the pickup day only cancelling is offered", () => {
    expect(bookingMovesOn(b, "2026-11-14")).toEqual(["cancelled"]);
  });
  it("on and after the pickup day active/completed are offered", () => {
    expect(bookingMovesOn(b, "2026-11-28")).toEqual(["active", "completed", "cancelled"]);
    expect(bookingMovesOn({ status: "active", start_date: "2026-11-28" }, "2026-11-30")).toEqual([
      "completed",
      "cancelled",
    ]);
  });
  it("pending bookings are unchanged (cancel only)", () => {
    expect(bookingMovesOn({ status: "pending", start_date: "2026-11-28" }, "2026-11-30")).toEqual([
      "cancelled",
    ]);
  });
});

describe("2. a kept booking fee of a cancelled booking is revenue", () => {
  const bookings = [
    { id: "fee", status: "cancelled", created_at: "2026-11-01T00:00:00Z", total_amount: 2970 },
    { id: "legacy", status: "cancelled", created_at: "2026-11-01T00:00:00Z", total_amount: 2970 },
    { id: "refunded", status: "cancelled", created_at: "2026-11-01T00:00:00Z", total_amount: 2970 },
  ];
  const pay = (booking_id: string, amount: number, refund_status: string) => ({
    booking_id,
    amount,
    status: "paid",
    paid_at: "2026-11-02T00:00:00Z",
    refund_status,
  });
  const payments = [
    pay("fee", 1000, "not_refunded"),
    pay("legacy", 2970, "not_refunded"), // full rent paid before the booking fee: not counted
    pay("refunded", 1000, "refunded"),
  ];
  it("counts only the kept 1,000 fee", () => {
    const map = bookingStatusMap(bookings);
    expect(payments.map((p) => isKeptBookingFee(p, map))).toEqual([true, false, false]);
    const r = computeReport({ bookings, payments, maintenance: [], range: "all" });
    expect(r.onlineRevenue).toBe(1000);
  });
});

describe("4. stock car photos are labelled", () => {
  const car = {
    id: "c1",
    brand: "Honda",
    model: "City",
    year: 2024,
    category: "eco",
    image_url: "eco",
    price_per_day: 1290,
    seats: 5,
    transmission: "อัตโนมัติ",
    fuel: "ไฮบริด",
  } as unknown as Tables<"cars">;
  it("a car without its own photo shows the caption; one with a photo does not", () => {
    expect(isStockCarImage("eco")).toBe(true);
    expect(isStockCarImage("https://example.test/city.jpg")).toBe(false);
    expect(carImage("https://example.test/city.jpg", "eco")).toBe("https://example.test/city.jpg");
    const { rerender } = render(<CarCard car={car} />);
    expect(screen.getByText("ภาพประกอบ")).toBeInTheDocument();
    rerender(<CarCard car={{ ...car, image_url: "https://example.test/city.jpg" }} />);
    expect(screen.queryByText("ภาพประกอบ")).not.toBeInTheDocument();
  });
});

describe("8. work queue while loading", () => {
  it("shows a placeholder instead of zeros, then the counts", () => {
    const { rerender } = render(
      <ContractWorkQueue contracts={[]} bookings={[]} onOpen={() => {}} loading />,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
    rerender(
      <ContractWorkQueue
        contracts={[{ status: "paid", booking_id: "b" }]}
        bookings={[]}
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByText("…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1\s*ชำระเงินแล้ว/ }));
  });
});

describe("the status dialog never preselects cancelling", () => {
  it("starts on the first non-cancel move, or on nothing when only cancelling is allowed", () => {
    expect(defaultBookingMove(["active", "completed", "cancelled"])).toBe("active");
    expect(defaultBookingMove(["cancelled"])).toBe("");
    expect(defaultBookingMove([])).toBe("");
  });
});
