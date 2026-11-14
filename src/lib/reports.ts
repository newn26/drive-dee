import { TZ } from "@/lib/format";

export type ReportRange = "all" | "30d" | "90d" | "year";

/** A payment only counts as revenue while its booking is still confirmed, active or completed. */
export const REVENUE_BOOKING_STATUSES = ["confirmed", "active", "completed"] as const;

type Amount = number | string | null | undefined;
export type ReportPayment = { booking_id: string; amount: Amount; status: string; paid_at: string };
export type ReportBooking = {
  id: string;
  status: string;
  created_at: string;
  total_amount: Amount;
  /** Pickup day (YYYY-MM-DD); dates the rent collected at the branch. */
  start_date?: string;
};
export type ReportMaintenance = {
  cost: Amount;
  scheduled_date: string;
  completed_date: string | null;
};
export type ReportRole = { user_id: string; role: string };

const DAY_MS = 86_400_000;

/** A plain YYYY-MM-DD date is a Bangkok calendar day; anything else is parsed as a timestamp. */
export const toInstant = (d: string | Date): Date =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(`${d}T00:00:00+07:00`)
    : new Date(d);

const bkkParts = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
};

/** "YYYY-MM" of the instant in Bangkok time. */
export const bkkMonthKey = (d: string | Date) => {
  const p = bkkParts(toInstant(d));
  return `${p.year}-${p.month}`;
};

/** "YYYY-MM-DD HH:mm" in Bangkok time, for CSV export. */
export const bkkDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "";
  const p = bkkParts(toInstant(d));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

/** First instant included in the range, or null for all time. */
export const rangeStart = (range: ReportRange, now: Date = new Date()): Date | null => {
  if (range === "30d") return new Date(now.getTime() - 30 * DAY_MS);
  if (range === "90d") return new Date(now.getTime() - 90 * DAY_MS);
  if (range === "year") return new Date(`${bkkParts(now).year}-01-01T00:00:00+07:00`);
  return null;
};

const inRange = (d: string, start: Date | null) =>
  !start || toInstant(d).getTime() >= start.getTime();

export const bookingStatusMap = (bookings: Pick<ReportBooking, "id" | "status">[]) => {
  const map: Record<string, string> = {};
  for (const b of bookings) map[b.id] = b.status;
  return map;
};

export const isRevenuePayment = (p: ReportPayment, statusByBooking: Record<string, string>) =>
  p.status === "paid" &&
  (REVENUE_BOOKING_STATUSES as readonly string[]).includes(statusByBooking[p.booking_id] ?? "");

/** Once the car is picked up (active/completed) the branch has collected the rest of the rent. */
export const PICKUP_COLLECTED_STATUSES = ["active", "completed"] as const;

/**
 * Rent collected at the branch on the pickup day: rent minus what was already paid online.
 * Booking-fee bookings paid 1,000 THB online, so the rest of the rent comes at pickup
 * (the deposit is returned, so it is not revenue). Bookings that paid the full rent online
 * (before the booking fee) have nothing left to collect. Not recorded in the database; derived.
 */
export function pickupCollections(bookings: ReportBooking[], payments: ReportPayment[]) {
  const paidOnline = new Map<string, number>();
  for (const p of payments)
    if (p.status === "paid")
      paidOnline.set(p.booking_id, (paidOnline.get(p.booking_id) ?? 0) + Number(p.amount ?? 0));
  return bookings
    .filter((b) => (PICKUP_COLLECTED_STATUSES as readonly string[]).includes(b.status))
    .map((b) => ({
      booking_id: b.id,
      date: b.start_date ?? b.created_at,
      amount: Math.max(Number(b.total_amount ?? 0) - (paidOnline.get(b.id) ?? 0), 0),
    }))
    .filter((c) => c.amount > 0);
}

/**
 * Revenue = recorded online payments (by payment date) + rent collected at pickup for bookings
 * whose car has been picked up (by pickup date). Unpaid pending bookings are never counted.
 * Maintenance cost is dated by the completion date when there is one, otherwise the scheduled date.
 */
export function computeReport(input: {
  bookings: ReportBooking[];
  payments: ReportPayment[];
  maintenance: ReportMaintenance[];
  range: ReportRange;
  now?: Date;
}) {
  const start = rangeStart(input.range, input.now);
  const statusByBooking = bookingStatusMap(input.bookings);

  const revenuePayments = input.payments.filter(
    (p) => isRevenuePayment(p, statusByBooking) && inRange(p.paid_at, start),
  );
  const onlineRevenue = revenuePayments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const pickupRevenue = pickupCollections(input.bookings, input.payments)
    .filter((c) => inRange(c.date, start))
    .reduce((s, c) => s + c.amount, 0);
  const revenue = onlineRevenue + pickupRevenue;

  const maintCost = input.maintenance
    .filter((m) => inRange(m.completed_date ?? m.scheduled_date, start))
    .reduce((s, m) => s + Number(m.cost ?? 0), 0);

  const bookingsInRange = input.bookings.filter((b) => inRange(b.created_at, start));
  const notCancelled = bookingsInRange.filter((b) => b.status !== "cancelled");

  return {
    revenue,
    onlineRevenue,
    pickupRevenue,
    maintCost,
    profit: revenue - maintCost,
    paidCount: revenuePayments.length,
    bookingCount: notCancelled.length,
    pendingCount: notCancelled.filter((b) => b.status === "pending").length,
    completedCount: notCancelled.filter((b) => b.status === "completed").length,
    cancelledCount: bookingsInRange.length - notCancelled.length,
  };
}

/** Revenue per month for the last `months` months (oldest first), keyed by Bangkok calendar month. */
export function monthlyRevenueSeries(
  payments: ReportPayment[],
  statusByBooking: Record<string, string>,
  now: Date = new Date(),
  months = 12,
  bookings: ReportBooking[] = [],
) {
  const p = bkkParts(now);
  const y = Number(p.year);
  const m = Number(p.month);
  const label = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, month: "short", year: "2-digit" });

  const series: { key: string; name: string; revenue: number; bookings: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    series.push({
      key,
      name: label.format(new Date(`${key}-15T00:00:00+07:00`)),
      revenue: 0,
      bookings: 0,
    });
  }

  const byKey = new Map(series.map((s) => [s.key, s]));
  for (const pay of payments) {
    if (!isRevenuePayment(pay, statusByBooking)) continue;
    const bucket = byKey.get(bkkMonthKey(pay.paid_at));
    if (bucket) {
      bucket.revenue += Number(pay.amount ?? 0);
      bucket.bookings += 1;
    }
  }
  // rent collected at the branch, in the month of the pickup day
  for (const c of pickupCollections(bookings, payments)) {
    const bucket = byKey.get(bkkMonthKey(c.date));
    if (bucket) bucket.revenue += c.amount;
  }
  return series;
}

/** Users with the customer role who are not admins. */
export const countCustomers = (roles: ReportRole[]) => {
  const admins = new Set(roles.filter((r) => r.role === "admin").map((r) => r.user_id));
  return new Set(
    roles.filter((r) => r.role === "customer" && !admins.has(r.user_id)).map((r) => r.user_id),
  ).size;
};

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export type CsvCell = string | number | null | undefined;

/**
 * Quote a CSV cell. Text that starts with = + - @ (or a tab/CR) gets a leading
 * apostrophe so spreadsheet apps don't run it as a formula.
 */
export const csvEscape = (value: CsvCell): string => {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? String(value) : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV text with a UTF-8 BOM so Excel shows Thai correctly. */
export const toCsv = (headers: string[], rows: CsvCell[][]) =>
  "﻿" + [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";

export type CsvBooking = ReportBooking & {
  booking_code: string;
  user_id: string;
  start_date: string;
  end_date: string;
  days: number;
  pickup_location: string;
  cars: { brand: string; model: string; plate_no: string } | null;
};
export type CsvPayment = ReportPayment & { method: string; reference: string };

export const BOOKING_CSV_HEADERS = [
  "รหัสการจอง",
  "วันที่จอง",
  "ลูกค้า",
  "รถยนต์",
  "ทะเบียน",
  "สถานที่รับรถ",
  "วันรับรถ",
  "วันคืนรถ",
  "จำนวนวัน",
  "สถานะการจอง",
  "ยอดรวม (THB)",
  "ชำระแล้ว (THB)",
  "เก็บ ณ วันรับรถ (THB)",
  "ช่องทางชำระ",
  "เลขอ้างอิงการชำระ",
  "วันที่ชำระ",
  "นับเป็นรายได้",
];

/** One row per booking created in the range (cancelled ones included, with their status). */
export function bookingReportCsv(input: {
  bookings: CsvBooking[];
  payments: CsvPayment[];
  customerNames: Record<string, string>;
  statusLabels: Record<string, string>;
  range: ReportRange;
  now?: Date;
}) {
  const start = rangeStart(input.range, input.now);
  const statusByBooking = bookingStatusMap(input.bookings);
  const paidByBooking = new Map<string, CsvPayment>();
  for (const p of input.payments) if (p.status === "paid") paidByBooking.set(p.booking_id, p);
  const atPickup = new Map(
    pickupCollections(input.bookings, input.payments).map((c) => [c.booking_id, c.amount]),
  );

  const rows = input.bookings
    .filter((b) => inRange(b.created_at, start))
    .map((b): CsvCell[] => {
      const pay = paidByBooking.get(b.id);
      return [
        b.booking_code,
        bkkDateTime(b.created_at),
        input.customerNames[b.user_id] || "",
        b.cars ? `${b.cars.brand} ${b.cars.model}` : "",
        b.cars?.plate_no ?? "",
        b.pickup_location,
        b.start_date,
        b.end_date,
        b.days,
        input.statusLabels[b.status] ?? b.status,
        Number(b.total_amount ?? 0),
        pay ? Number(pay.amount ?? 0) : 0,
        atPickup.get(b.id) ?? 0,
        pay ? (pay.method === "qr" ? "QR PromptPay (DEMO)" : "บัตรเครดิต (DEMO)") : "",
        pay?.reference ?? "",
        bkkDateTime(pay?.paid_at),
        pay && isRevenuePayment(pay, statusByBooking) ? "ใช่" : "ไม่",
      ];
    });
  return toCsv(BOOKING_CSV_HEADERS, rows);
}

export const MAINTENANCE_CSV_HEADERS = [
  "รถยนต์",
  "ทะเบียน",
  "งานซ่อมบำรุง",
  "รายละเอียด",
  "วันที่นัดหมาย",
  "วันที่เสร็จ",
  "สถานะ",
  "ค่าใช้จ่าย (THB)",
];

export function maintenanceReportCsv(input: {
  maintenance: (ReportMaintenance & {
    title: string;
    description: string | null;
    status: string;
    cars: { brand: string; model: string; plate_no: string } | null;
  })[];
  statusLabels: Record<string, string>;
  range: ReportRange;
  now?: Date;
}) {
  const start = rangeStart(input.range, input.now);
  const rows = input.maintenance
    .filter((m) => inRange(m.completed_date ?? m.scheduled_date, start))
    .map((m): CsvCell[] => [
      m.cars ? `${m.cars.brand} ${m.cars.model}` : "",
      m.cars?.plate_no ?? "",
      m.title,
      m.description ?? "",
      m.scheduled_date,
      m.completed_date ?? "",
      input.statusLabels[m.status] ?? m.status,
      Number(m.cost ?? 0),
    ]);
  return toCsv(MAINTENANCE_CSV_HEADERS, rows);
}

/** Trigger a browser download of text content. */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/csv;charset=utf-8",
) {
  // UTF-8 byte order mark so Excel shows Thai text correctly instead of garbled characters
  const body = mime.startsWith("text/csv") && !content.startsWith("﻿") ? "﻿" + content : content;
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
