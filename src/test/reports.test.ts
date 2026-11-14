import { describe, expect, it, vi } from "vitest";
import {
  bkkMonthKey,
  bookingReportCsv,
  bookingStatusMap,
  computeReport,
  countCustomers,
  csvEscape,
  maintenanceReportCsv,
  maintenanceCostError,
  monthlyRevenueSeries,
  rangeStart,
  toCsv,
  type CsvBooking,
  type CsvPayment,
} from "@/lib/reports";
import { bookingStatusLabel, maintStatusLabel } from "@/lib/format";

const NOW = new Date("2026-11-11T05:00:00Z"); // 12:00 Bangkok

const booking = (id: string, status: string, created_at: string, total = 1000): CsvBooking => ({
  id,
  status,
  created_at,
  total_amount: total,
  booking_code: `BK-${id}`,
  user_id: `u-${id}`,
  start_date: "2026-11-20",
  end_date: "2026-11-21",
  days: 2,
  pickup_location: "สาขากรุงเทพฯ",
  cars: { brand: "Toyota", model: "Yaris", plate_no: "1กข 1234" },
});

const payment = (
  booking_id: string,
  amount: number,
  paid_at: string,
  status = "paid",
): CsvPayment => ({
  booking_id,
  amount,
  paid_at,
  status,
  method: "qr",
  reference: `REF-${booking_id}`,
});

describe("Reports — revenue comes from payments", () => {
  const bookings = [
    booking("paid", "confirmed", "2026-11-01T03:00:00Z", 3000),
    booking("pending", "pending", "2026-11-02T03:00:00Z", 9999),
    booking("cancelled", "cancelled", "2026-11-03T03:00:00Z", 2000),
    booking("done", "completed", "2026-06-01T03:00:00Z", 1500),
  ];
  const payments = [
    payment("paid", 3000, "2026-11-01T03:05:00Z"),
    payment("cancelled", 2000, "2026-11-03T03:05:00Z"),
    payment("done", 1500, "2026-06-01T03:05:00Z"),
    payment("pending", 9999, "2026-11-02T03:05:00Z", "failed"),
  ];

  it("excludes unpaid pending bookings, failed payments and cancelled bookings", () => {
    const r = computeReport({ bookings, payments, maintenance: [], range: "all", now: NOW });
    expect(r.revenue).toBe(4500);
    expect(r.paidCount).toBe(2);
    expect(r.pendingCount).toBe(1);
    expect(r.cancelledCount).toBe(1);
    expect(r.bookingCount).toBe(3);
  });

  it("filters revenue by payment date for 30-day range", () => {
    const r = computeReport({ bookings, payments, maintenance: [], range: "30d", now: NOW });
    expect(r.revenue).toBe(3000);
  });

  it("subtracts maintenance cost dated by completion date, else scheduled date", () => {
    const maintenance = [
      { cost: 500, scheduled_date: "2026-01-10", completed_date: "2026-11-05" },
      { cost: 700, scheduled_date: "2026-01-10", completed_date: null },
    ];
    const r = computeReport({ bookings, payments, maintenance, range: "30d", now: NOW });
    expect(r.maintCost).toBe(500);
    expect(r.profit).toBe(2500);
  });

  it("starts 'this year' at midnight Bangkok time, not UTC", () => {
    const now = new Date("2025-12-31T17:30:00Z"); // 2026-01-01 00:30 Bangkok
    expect(rangeStart("year", now)?.toISOString()).toBe("2025-12-31T17:00:00.000Z");
    const b = [
      booking("a", "confirmed", "2025-12-31T16:00:00Z"),
      booking("b", "confirmed", "2025-12-31T17:10:00Z"),
    ];
    const p = [
      payment("a", 100, "2025-12-31T16:00:00Z"),
      payment("b", 200, "2025-12-31T17:10:00Z"),
    ];
    expect(
      computeReport({ bookings: b, payments: p, maintenance: [], range: "year", now }).revenue,
    ).toBe(200);
  });
});

describe("Reports — monthly chart", () => {
  it("returns the last 12 months in order and never mixes years", () => {
    const bookings = [
      booking("old", "completed", "2025-11-05T03:00:00Z"),
      booking("new", "completed", "2026-11-05T03:00:00Z"),
    ];
    const payments = [
      payment("old", 1000, "2025-11-05T03:00:00Z"),
      payment("new", 2000, "2026-11-05T03:00:00Z"),
    ];
    const series = monthlyRevenueSeries(payments, bookingStatusMap(bookings), NOW);
    expect(series).toHaveLength(12);
    expect(series[0]?.key).toBe("2025-12");
    expect(series[11]?.key).toBe("2026-11");
    expect(series.reduce((s, m) => s + m.revenue, 0)).toBe(2000);
    expect(series[11]?.revenue).toBe(2000);
  });

  it("buckets by Bangkok calendar month", () => {
    expect(bkkMonthKey("2026-10-31T18:00:00Z")).toBe("2026-11");
    expect(bkkMonthKey("2026-10-31T16:00:00Z")).toBe("2026-10");
  });
});

describe("Reports — customers", () => {
  it("does not count admins as customers", () => {
    const roles = [
      { user_id: "admin", role: "admin" },
      { user_id: "admin", role: "customer" },
      { user_id: "c1", role: "customer" },
      { user_id: "c2", role: "customer" },
    ];
    expect(countCustomers(roles)).toBe(2);
  });
});

describe("CSV export", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe("");
  });

  it("neutralises spreadsheet formulas in text but keeps negative numbers", () => {
    expect(csvEscape('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvEscape("@cmd")).toBe("'@cmd");
    expect(csvEscape(-500)).toBe("-500");
  });

  it("starts with a UTF-8 BOM and uses CRLF line endings", () => {
    const csv = toCsv(["ก", "ข"], [[1, "สอง"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿ก,ข\r\n1,สอง\r\n");
  });

  it("exports one row per booking in range, with payment details marked DEMO", () => {
    const bookings = [
      booking("a", "confirmed", "2026-11-01T03:00:00Z", 3000),
      booking("old", "completed", "2026-01-01T03:00:00Z"),
    ];
    const payments = [payment("a", 3000, "2026-11-01T03:05:00Z")];
    const csv = bookingReportCsv({
      bookings,
      payments,
      customerNames: { "u-a": "สมชาย, ใจดี" },
      statusLabels: bookingStatusLabel,
      range: "30d",
      now: NOW,
    });
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("BK-a");
    expect(lines[1]).toContain('"สมชาย, ใจดี"');
    expect(lines[1]).toContain("ยืนยันแล้ว");
    expect(lines[1]).toContain("QR PromptPay (DEMO)");
    expect(lines[1]).toContain("2026-11-01 10:05");
  });

  it("exports maintenance records in range", () => {
    const csv = maintenanceReportCsv({
      maintenance: [
        {
          title: "เปลี่ยนน้ำมันเครื่อง",
          description: null,
          status: "completed",
          cost: 1200,
          scheduled_date: "2026-11-01",
          completed_date: "2026-11-02",
          cars: { brand: "Honda", model: "City", plate_no: "2กข 5678" },
        },
      ],
      statusLabels: maintStatusLabel,
      range: "all",
      now: NOW,
    });
    expect(csv).toContain(
      "Honda City,2กข 5678,เปลี่ยนน้ำมันเครื่อง,,2026-11-01,2026-11-02,เสร็จสิ้น,1200",
    );
  });
});

describe("CSV download", () => {
  it("starts CSV files with a UTF-8 byte order mark so Excel shows Thai text", async () => {
    const { downloadTextFile } = await import("@/lib/reports");
    const parts: BlobPart[][] = [];
    const RealBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends RealBlob {
        constructor(p: BlobPart[], o?: BlobPropertyBag) {
          parts.push(p);
          super(p, o);
        }
      },
    );
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadTextFile("x.csv", "รหัส,ยอด\r\n");
    expect(String(parts[0]![0]).startsWith("﻿")).toBe(true);
    expect(click).toHaveBeenCalled();
    vi.unstubAllGlobals();
    create.mockRestore();
    revoke.mockRestore();
    click.mockRestore();
  });
});

describe("Reports — booking fee: rent collected at pickup counts once the car is picked up", () => {
  const b = (id: string, status: string, total: number, start = "2026-11-05") => ({
    ...booking(id, status, "2026-11-01T03:00:00Z", total),
    start_date: start,
  });
  const fee = (id: string) => payment(id, 1000, "2026-11-01T03:05:00Z");

  it("confirmed (not picked up yet) counts only the fee; active/completed count the full rent", () => {
    const bookings = [
      b("conf", "confirmed", 2970),
      b("act", "active", 2970),
      b("done", "completed", 1980),
    ];
    const payments = [fee("conf"), fee("act"), fee("done")];
    const r = computeReport({ bookings, payments, maintenance: [], range: "all", now: NOW });
    expect(r.onlineRevenue).toBe(3000);
    expect(r.pickupRevenue).toBe(1970 + 980);
    expect(r.revenue).toBe(1000 + 2970 + 1980);
  });

  it("a booking that paid the full rent online has nothing left to collect", () => {
    const bookings = [b("legacy", "completed", 1500)];
    const payments = [payment("legacy", 1500, "2026-11-01T03:05:00Z")];
    const r = computeReport({ bookings, payments, maintenance: [], range: "all", now: NOW });
    expect(r.pickupRevenue).toBe(0);
    expect(r.revenue).toBe(1500);
  });

  it("the monthly chart puts the pickup collection in the pickup month", () => {
    const bookings = [b("act", "active", 2970, "2026-10-20")];
    const payments = [fee("act")]; // paid in November
    const series = monthlyRevenueSeries(payments, bookingStatusMap(bookings), NOW, 12, bookings);
    expect(series.find((s) => s.key === "2026-10")!.revenue).toBe(1970);
    expect(series.find((s) => s.key === "2026-11")!.revenue).toBe(1000);
  });

  it("CSV shows what was collected at pickup", () => {
    const csv = bookingReportCsv({
      bookings: [b("act", "active", 2970)],
      payments: [fee("act")],
      customerNames: {},
      statusLabels: bookingStatusLabel,
      range: "all",
      now: NOW,
    });
    const [header, row] = csv.replace(/^﻿/, "").split(/\r?\n/);
    const cols = header!.split(",");
    const cells = row!.split(",");
    expect(cells[cols.indexOf("ชำระแล้ว (THB)")]).toBe("1000");
    expect(cells[cols.indexOf("เก็บ ณ วันรับรถ (THB)")]).toBe("1970");
  });
});

describe("Reports — maintenance cost can never lower expenses", () => {
  it("a negative cost counts as 0; the form rejects it", () => {
    const r = computeReport({
      bookings: [],
      payments: [],
      maintenance: [
        { cost: 4000, scheduled_date: "2026-11-10", completed_date: "2026-11-10" },
        { cost: -50, scheduled_date: "2026-11-10", completed_date: "2026-11-10" },
        { cost: 0, scheduled_date: "2026-11-10", completed_date: null },
      ],
      range: "all",
      now: NOW,
    });
    expect(r.maintCost).toBe(4000);
    expect(maintenanceCostError(-50)).toMatch(/ตั้งแต่ 0 บาท/);
    expect(maintenanceCostError(Number.NaN)).toMatch(/ตั้งแต่ 0 บาท/);
    expect(maintenanceCostError(0)).toBeNull();
    expect(maintenanceCostError(4000)).toBeNull();
  });
});
