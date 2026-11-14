/**
 * Bookings past their pickup/return day that nobody updated, and fleet counts that take them
 * into account (third live walkthrough, item 1). Fictional data only.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { carsOutToday, fleetCounts, overdueHandovers, overdueReturns } from "@/lib/fleet";
import { OverdueBookingsCard, type OverdueBooking } from "@/components/admin/overdue-bookings-card";

const TODAY = "2026-11-14";
const car = { brand: "Toyota", model: "Yaris", plate_no: "1กข 1234" };
const b = (
  id: string,
  status: string,
  start_date: string,
  end_date: string,
  car_id = `car-${id}`,
): OverdueBooking & { user_id: string } => ({
  id,
  booking_code: `BK-${id}`,
  car_id,
  status,
  start_date,
  end_date,
  user_id: "u1",
  cars: car,
});

const bookings = [
  b("due-today", "confirmed", "2026-11-14", "2026-11-16"),
  b("started", "confirmed", "2026-11-13", "2026-11-15"),
  b("ended", "confirmed", "2026-11-10", "2026-11-12"),
  b("future", "confirmed", "2026-11-20", "2026-11-21"),
  b("late-return", "active", "2026-11-10", "2026-11-13"),
  b("on-rent", "active", "2026-11-13", "2026-11-16"),
  b("pending", "pending", "2026-11-14", "2026-11-15"),
];

describe("overdue bookings", () => {
  it("hand-overs: confirmed and the pickup day has come (oldest first)", () => {
    expect(overdueHandovers(bookings, TODAY).map((x) => x.id)).toEqual([
      "ended",
      "started",
      "due-today",
    ]);
  });
  it("returns: active and past the return day", () => {
    expect(overdueReturns(bookings, TODAY).map((x) => x.id)).toEqual(["late-return"]);
  });
});

describe("fleet counts", () => {
  it("a car due out today counts as rented even if the hand-over was not recorded", () => {
    const out = carsOutToday(bookings, TODAY);
    expect([...out].sort()).toEqual(
      ["car-due-today", "car-late-return", "car-on-rent", "car-started"].sort(),
    );
    const cars = [
      { id: "car-due-today", status: "available" },
      { id: "car-started", status: "available" },
      { id: "car-future", status: "available" },
      { id: "car-x", status: "maintenance" },
      { id: "car-y", status: "unavailable" },
      { id: "car-z", status: "rented" },
    ];
    expect(fleetCounts(cars, bookings, TODAY)).toEqual({
      total: 6,
      rented: 3,
      maintenance: 1,
      unavailable: 1,
      available: 1,
      utilizationRate: 50,
    });
  });
  it("maintenance wins over a booking", () => {
    const counts = fleetCounts([{ id: "car-started", status: "maintenance" }], bookings, TODAY);
    expect(counts.maintenance).toBe(1);
    expect(counts.rented).toBe(0);
  });
});

describe("overdue card", () => {
  it("lists both kinds and opens the status dialog for a booking", () => {
    const onUpdate = vi.fn();
    render(
      <OverdueBookingsCard
        bookings={bookings}
        today={TODAY}
        customerName={() => "ทดสอบ ลูกค้า"}
        onUpdate={onUpdate}
        canUpdate
      />,
    );
    expect(screen.getByText("ต้องดำเนินการวันนี้ (4)")).toBeInTheDocument();
    expect(screen.getByText("ถึงวันรับรถแล้ว ยังไม่ส่งมอบ (3)")).toBeInTheDocument();
    expect(screen.getByText("เลยวันคืนรถแล้ว ยังไม่รับคืน (1)")).toBeInTheDocument();
    expect(screen.getByText(/สิ้นสุดแล้ว: บันทึกว่าเสร็จสิ้น หรือยกเลิก/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "เปลี่ยนสถานะ" })[0]!);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: "ended" }));
  });
  it("says so when nothing is overdue", () => {
    render(
      <OverdueBookingsCard
        bookings={[bookings[3]!]}
        today={TODAY}
        customerName={() => ""}
        onUpdate={() => {}}
        canUpdate
      />,
    );
    expect(screen.getByText("ต้องดำเนินการวันนี้ (0)")).toBeInTheDocument();
    expect(screen.getByText("ไม่มีรายการค้าง")).toBeInTheDocument();
  });
});
