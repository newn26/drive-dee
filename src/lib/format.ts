import { bilingual, getLang, intlLocale } from "@/lib/i18n";
export const TZ = "Asia/Bangkok";

export const thb = (n: number | string | null | undefined) =>
  new Intl.NumberFormat(intlLocale(), {
    style: "currency",
    currency: "THB",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(
    Number(n ?? 0),
  );

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "-";
  const date = typeof d === "string" && d.length === 10 ? new Date(d + "T00:00:00+07:00") : new Date(d);
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(date);
};

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat(intlLocale(), { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(d))
    : "-";

/** YYYY-MM-DD for "today" in Bangkok */
export const todayBkk = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
};

export const daysBetween = (start: string, end: string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;

export const bookingStatusLabel: Record<string, string> = bilingual({
  pending: ["รอดำเนินการ", "Pending"],
  confirmed: ["ยืนยันแล้ว", "Confirmed"],
  active: ["กำลังเช่า", "In progress"],
  completed: ["เสร็จสิ้น", "Completed"],
  cancelled: ["ยกเลิก", "Cancelled"],
});
export const carStatusLabel: Record<string, string> = bilingual({
  available: ["ว่าง", "Available"],
  rented: ["ถูกเช่า", "Rented"],
  maintenance: ["ซ่อมบำรุง", "Maintenance"],
  unavailable: ["งดให้บริการ", "Unavailable"],
});
export const maintStatusLabel: Record<string, string> = bilingual({
  scheduled: ["นัดหมายแล้ว", "Scheduled"],
  in_progress: ["กำลังดำเนินการ", "In progress"],
  completed: ["เสร็จสิ้น", "Completed"],
});
/** Pickup points (stored in Thai in bookings.pickup_location); shown in the current language. */
const PICKUP_LOCATION_EN: Record<string, string> = {
  "สาขากรุงเทพฯ (สุขุมวิท)": "Bangkok branch (Sukhumvit)",
  สนามบินสุวรรณภูมิ: "Suvarnabhumi Airport",
  สนามบินดอนเมือง: "Don Mueang Airport",
  สาขาเชียงใหม่: "Chiang Mai branch",
  สาขาภูเก็ต: "Phuket branch",
};
export const pickupLocationLabel = (loc: string | null | undefined) =>
  !loc ? "-" : getLang() === "en" ? (PICKUP_LOCATION_EN[loc] ?? loc) : loc;

/** Car transmission / fuel values are stored in Thai; shown in the current language. */
const CAR_SPEC_EN: Record<string, string> = {
  อัตโนมัติ: "Automatic",
  ธรรมดา: "Manual",
  เบนซิน: "Petrol",
  ดีเซล: "Diesel",
  ไฟฟ้า: "Electric",
  ไฮบริด: "Hybrid",
};
export const carSpecLabel = (value: string | null | undefined) =>
  !value ? "-" : getLang() === "en" ? (CAR_SPEC_EN[value] ?? value) : value;

export const categoryLabel: Record<string, string> = bilingual({
  eco: ["อีโคคาร์", "Eco car"],
  sedan: ["ซีดาน", "Sedan"],
  suv: ["SUV", "SUV"],
  van: ["รถตู้", "Van"],
  ev: ["รถไฟฟ้า", "Electric"],
});
