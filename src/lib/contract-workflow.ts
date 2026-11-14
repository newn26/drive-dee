/**
 * Contract approval workflow: statuses, labels and the rules the UI follows.
 *
 * The database (docs/database/contract-approval-workflow.sql) is the real boundary: every
 * transition below is enforced there too. These helpers only decide what the UI shows.
 */

export const CONTRACT_STATUSES = [
  "draft",
  "pending_customer",
  "pending_admin_review",
  "revision_requested",
  "approved",
  "paid",
  "cancelled",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const isContractStatus = (s: unknown): s is ContractStatus =>
  typeof s === "string" && (CONTRACT_STATUSES as readonly string[]).includes(s);

/** Labels for admins. */
export const contractStatusLabel: Record<ContractStatus, string> = {
  draft: "ฉบับร่าง",
  pending_customer: "รอลูกค้าตรวจสอบ",
  pending_admin_review: "รอผู้ดูแลอนุมัติ",
  revision_requested: "ขอแก้ไขสัญญา",
  approved: "ลูกค้ายืนยันแล้ว · รอชำระค่าจอง",
  paid: "ชำระเงินแล้ว",
  cancelled: "ยกเลิก",
};

/**
 * Labels for the customer. A draft of a contract the customer has already been sent
 * means the admin is preparing a new version.
 */
export function customerContractLabel(status: ContractStatus, everSent: boolean): string {
  if (status === "draft") return everSent ? "ผู้ดูแลกำลังแก้ไขสัญญา" : "รอผู้ดูแลจัดทำสัญญา";
  if (status === "pending_customer") return "รอคุณตรวจสอบสัญญา";
  return contractStatusLabel[status];
}

/** Allowed status moves; must match guard_contract_update() in the migration. */
export const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  draft: ["pending_customer", "cancelled"],
  pending_customer: [
    "approved",
    "pending_admin_review",
    "revision_requested",
    "draft",
    "cancelled",
  ],
  pending_admin_review: ["approved", "revision_requested", "draft", "cancelled"],
  revision_requested: ["draft", "cancelled"],
  approved: ["paid", "draft", "cancelled"],
  paid: ["cancelled"],
  cancelled: [],
};

export const canTransition = (from: ContractStatus, to: ContractStatus) =>
  CONTRACT_TRANSITIONS[from].includes(to);

/** The minimal contract shape these helpers need. */
export type ContractLike = {
  status: string;
  current_version: number;
  sent_version: number | null;
};

export type BookingLike = { status: string; hold_expires_at?: string | null };

/** Hold still running (the server re-checks; this is for the UI). */
export const holdActive = (b: BookingLike, now: number = Date.now()) =>
  b.status === "pending" && !!b.hold_expires_at && new Date(b.hold_expires_at).getTime() > now;

/**
 * The booking fee is offered once the customer has confirmed the sent contract
 * (status 'approved'; docs/database/booking-fee-flow.sql), while the 15-minute window runs.
 */
export const canPay = (
  b: BookingLike,
  c: ContractLike | null | undefined,
  now: number = Date.now(),
) => !!c && c.status === "approved" && holdActive(b, now);

/** The customer can accept (or ask to revise) only the version they were sent, while it is current. */
export const canCustomerRespond = (
  b: BookingLike,
  c: ContractLike | null | undefined,
  now: number = Date.now(),
) =>
  !!c &&
  c.status === "pending_customer" &&
  c.sent_version !== null &&
  c.sent_version === c.current_version &&
  holdActive(b, now);

/** Admin may edit (in place for an unsent draft, otherwise as a new version) until payment. */
export const canAdminEdit = (c: ContractLike) => !["paid", "cancelled"].includes(c.status);
export const canAdminSend = (c: ContractLike) => c.status === "draft";
export const canAdminReview = (c: ContractLike) => c.status === "pending_admin_review";

/** Which stage a pending booking is in, from the customer's point of view. */
export type CustomerStage =
  | "awaiting_contract"
  | "review_contract"
  | "awaiting_approval"
  | "revision_requested"
  | "awaiting_payment"
  | "confirmed"
  | "completed"
  | "cancelled";

export function customerStage(
  b: { status: string },
  c: ContractLike | null | undefined,
): CustomerStage {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "completed") return "completed";
  if (b.status === "confirmed" || b.status === "active") return "confirmed";
  if (!c || c.status === "draft") return "awaiting_contract";
  if (c.status === "pending_customer") return "review_contract";
  if (c.status === "pending_admin_review") return "awaiting_approval";
  if (c.status === "revision_requested") return "revision_requested";
  if (c.status === "approved") return "awaiting_payment";
  return "cancelled";
}

export const customerStageLabel: Record<CustomerStage, string> = {
  awaiting_contract: "รอสัญญา",
  review_contract: "รอตรวจสัญญา",
  awaiting_approval: "รออนุมัติ",
  revision_requested: "ขอแก้ไขสัญญา",
  awaiting_payment: "รอชำระเงิน",
  confirmed: "ยืนยันแล้ว",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
};

// ---------------------------------------------------------------------------
// Bookings: status moves an admin may make by hand (must match validate_booking)
// ---------------------------------------------------------------------------

/**
 * pending → confirmed is never offered: it happens only through DEMO payment or the
 * Owner's audited manual confirmation.
 */
export const ADMIN_BOOKING_MOVES: Readonly<Record<string, readonly string[]>> = {
  pending: ["cancelled"],
  confirmed: ["active", "completed", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const adminBookingMoves = (status: string): readonly string[] =>
  ADMIN_BOOKING_MOVES[status] ?? [];

// ---------------------------------------------------------------------------
// Contract events
// ---------------------------------------------------------------------------

export const contractEventLabel: Record<string, string> = {
  legacy_import: "นำเข้าสัญญาเดิม",
  created: "สร้างฉบับร่าง",
  edited: "แก้ไขสัญญา",
  sent: "ส่งให้ลูกค้าตรวจสอบ",
  accepted: "ลูกค้ายอมรับสัญญา",
  revision_requested: "ขอแก้ไขสัญญา",
  approved: "ผู้ดูแลอนุมัติสัญญา",
  paid: "ชำระเงิน (DEMO)",
  cancelled: "ยกเลิก",
  expired: "หมดเวลา",
  manual_confirm: "ยืนยันการจองด้วยตนเอง (Owner)",
};

export const actorRoleLabel: Record<string, string> = {
  owner: "เจ้าของระบบ",
  admin: "ผู้ดูแลระบบ",
  customer: "ลูกค้า",
  system: "ระบบ",
};

// ---------------------------------------------------------------------------
// Payments: cancellation is not a refund
// ---------------------------------------------------------------------------

export const refundStatusLabel: Record<string, string> = {
  none: "-",
  not_refunded: "ยกเลิกแล้ว · ยังไม่คืนเงิน (DEMO ไม่มีระบบคืนเงิน)",
  refunded: "คืนเงินแล้ว",
};

// ---------------------------------------------------------------------------
// Contract form helpers
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" + "HH:MM" (Bangkok) → ISO timestamp with +07:00. */
export const bangkokTimestamp = (date: string, time: string) => `${date}T${time}:00+07:00`;

/** "HH:MM" in Bangkok time of an ISO timestamp. */
export function bangkokTime(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const bkk = new Date(d.getTime() + 7 * 3_600_000);
  return `${String(bkk.getUTCHours()).padStart(2, "0")}:${String(bkk.getUTCMinutes()).padStart(2, "0")}`;
}

export type ContractForm = {
  pickupTime: string;
  returnTime: string;
  deposit: number;
  mileageAllowance: string;
  latePenalty: string;
  additionalConditions: string;
  includeLicence: boolean;
};

export const DEFAULT_CONTRACT_FORM: ContractForm = {
  pickupTime: "10:00",
  returnTime: "18:00",
  deposit: 5000,
  mileageAllowance: "ไม่จำกัดระยะทาง",
  latePenalty: "500 บาท / ชั่วโมง",
  additionalConditions: "",
  includeLicence: false,
};

/** Thai error message, or null when the form is valid (the server checks again). */
export function validateContractForm(
  f: ContractForm,
  startDate: string,
  endDate: string,
): string | null {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(f.pickupTime) || !time.test(f.returnTime))
    return "กรุณาระบุเวลารับ-คืนรถให้ถูกต้อง (HH:MM)";
  if (!withinHours(f.pickupTime) || !withinHours(f.returnTime))
    return `เวลารับรถและคืนรถต้องอยู่ระหว่าง ${OPENING_TIME}-${CLOSING_TIME} น.`;
  if (startDate === endDate && f.returnTime <= f.pickupTime) return "เวลาคืนรถต้องหลังเวลารับรถ";
  if (!Number.isFinite(f.deposit) || f.deposit < 0)
    return "เงินประกันต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป";
  if (!f.mileageAllowance.trim()) return "กรุณาระบุข้อกำหนดระยะทาง";
  if (!f.latePenalty.trim()) return "กรุณาระบุค่าปรับส่งคืนล่าช้า";
  return null;
}

/** Branch opening hours: pickup and return times must fall inside them. */
export const OPENING_TIME = "08:00";
export const CLOSING_TIME = "18:00";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const withinHours = (t: string) => HHMM.test(t) && t >= OPENING_TIME && t <= CLOSING_TIME;

/** What a customer can ask to change in a sent contract. */
export type RevisionRequest = { customerName: string; pickupTime: string; returnTime: string };

/** Thai error message, or null when the request is valid. */
export function revisionRequestError(r: RevisionRequest, sameDay: boolean): string | null {
  if (r.customerName.trim().length < 2) return "กรุณากรอกชื่อลูกค้า";
  if (!withinHours(r.pickupTime) || !withinHours(r.returnTime))
    return `เวลารับรถและคืนรถต้องอยู่ระหว่าง ${OPENING_TIME}-${CLOSING_TIME} น.`;
  if (sameDay && r.returnTime <= r.pickupTime) return "เวลาคืนรถต้องหลังเวลารับรถ";
  return null;
}

/** The reason text sent to the admin (customer_request_revision needs at least 5 characters). */
export const revisionReasonText = (r: RevisionRequest) =>
  [
    `ชื่อลูกค้า: ${r.customerName.trim()}`,
    `เวลารับรถ: ${r.pickupTime} น.`,
    `เวลาคืนรถ: ${r.returnTime} น.`,
  ].join("\n");

/** Reads back a request written by revisionReasonText; null for free-text reasons. */
export function parseRevisionReason(text: string | null | undefined): RevisionRequest | null {
  const m = /ชื่อลูกค้า: (.+)\nเวลารับรถ: (\d{2}:\d{2}) น\.\nเวลาคืนรถ: (\d{2}:\d{2}) น\./.exec(
    (text ?? "").replace(/\r\n/g, "\n"),
  );
  return m ? { customerName: m[1]!.trim(), pickupTime: m[2]!, returnTime: m[3]! } : null;
}

/** A reason for a revision request or a manual confirmation (same minimums as the database). */
export const reasonError = (reason: string, min: number) =>
  reason.trim().length < min ? `กรุณาระบุเหตุผลอย่างน้อย ${min} ตัวอักษร` : null;
