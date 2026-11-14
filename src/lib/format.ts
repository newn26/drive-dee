export const TZ = "Asia/Bangkok";

export const thb = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(
    Number(n ?? 0),
  );

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "-";
  const date = typeof d === "string" && d.length === 10 ? new Date(d + "T00:00:00+07:00") : new Date(d);
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(date);
};

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("th-TH", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(d))
    : "-";

/** YYYY-MM-DD for "today" in Bangkok */
export const todayBkk = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
};

export const daysBetween = (start: string, end: string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;

export const bookingStatusLabel: Record<string, string> = {
  pending: "รอดำเนินการ",
  confirmed: "ยืนยันแล้ว",
  active: "กำลังเช่า",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
};
export const carStatusLabel: Record<string, string> = {
  available: "ว่าง",
  rented: "ถูกเช่า",
  maintenance: "ซ่อมบำรุง",
  unavailable: "งดให้บริการ",
};
export const maintStatusLabel: Record<string, string> = {
  scheduled: "นัดหมายแล้ว",
  in_progress: "กำลังดำเนินการ",
  completed: "เสร็จสิ้น",
};
export const categoryLabel: Record<string, string> = {
  eco: "อีโคคาร์",
  sedan: "ซีดาน",
  suv: "SUV",
  van: "รถตู้",
  ev: "รถไฟฟ้า",
};
