import { bilingual, tr } from "@/lib/i18n";
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
export const contractStatusLabel: Record<ContractStatus, string> = bilingual({
  draft: ["ฉบับร่าง", "Draft"],
  pending_customer: ["รอลูกค้าตรวจสอบ", "Waiting for customer"],
  pending_admin_review: ["รอผู้ดูแลอนุมัติ (ระบบเดิม)", "Waiting for staff approval (legacy)"],
  revision_requested: ["ขอแก้ไขสัญญา", "Changes requested"],
  approved: ["ลูกค้ายืนยันแล้ว · รอชำระค่าจอง", "Confirmed · booking fee due"],
  paid: ["ชำระเงินแล้ว", "Paid"],
  cancelled: ["ยกเลิก", "Cancelled"],
});

/**
 * Labels for the customer. A draft of a contract the customer has already been sent
 * means the admin is preparing a new version.
 */
export function customerContractLabel(status: ContractStatus, everSent: boolean): string {
  if (status === "draft")
    return everSent
      ? tr("ผู้ดูแลกำลังแก้ไขสัญญา", "Staff are updating the contract")
      : tr("รอผู้ดูแลจัดทำสัญญา", "Waiting for staff to prepare the contract");
  if (status === "pending_customer") return tr("รอคุณตรวจสอบสัญญา", "Please review your contract");
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

export const customerStageLabel: Record<CustomerStage, string> = bilingual({
  awaiting_contract: ["รอสัญญา", "Awaiting contract"],
  review_contract: ["รอตรวจสัญญา", "Review contract"],
  awaiting_approval: ["รอผู้ดูแล (ระบบเดิม)", "Waiting for staff (legacy)"],
  revision_requested: ["ขอแก้ไขสัญญา", "Changes requested"],
  awaiting_payment: ["รอชำระเงิน", "Awaiting payment"],
  confirmed: ["ยืนยันแล้ว", "Confirmed"],
  completed: ["เสร็จสิ้น", "Completed"],
  cancelled: ["ยกเลิก", "Cancelled"],
});

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

/**
 * The move the status dialog starts on: the first move that is not a cancellation.
 * Cancelling is never preselected (one careless "save" would cancel a paid booking); when it is
 * the only move, the admin must choose it. Returns "" when nothing should be preselected.
 */
export const defaultBookingMove = (moves: readonly string[]): string =>
  moves.find((m) => m !== "cancelled") ?? "";

/** Handing the car over (active) or taking it back (completed) only from the pickup day on. */
export const PICKUP_DAY_MOVES = ["active", "completed"] as const;

/**
 * The moves an admin may make today: adminBookingMoves without "active"/"completed" before the
 * pickup day (`today` and `start_date` are Bangkok YYYY-MM-DD). Enforced in the admin UI.
 */
export const bookingMovesOn = (
  b: { status: string; start_date: string },
  today: string,
): readonly string[] =>
  adminBookingMoves(b.status).filter(
    (m) => !(PICKUP_DAY_MOVES as readonly string[]).includes(m) || today >= b.start_date,
  );

// ---------------------------------------------------------------------------
// Contract events
// ---------------------------------------------------------------------------

export const contractEventLabel: Record<string, string> = bilingual({
  legacy_import: ["นำเข้าสัญญาเดิม", "Imported legacy contract"],
  created: ["สร้างฉบับร่าง", "Draft created"],
  edited: ["แก้ไขสัญญา", "Contract edited"],
  sent: ["ส่งให้ลูกค้าตรวจสอบ", "Sent to customer"],
  accepted: ["ลูกค้ายอมรับสัญญา", "Customer confirmed"],
  revision_requested: ["ขอแก้ไขสัญญา", "Changes requested"],
  approved: ["ผู้ดูแลอนุมัติสัญญา (ระบบเดิม)", "Staff approved (legacy)"],
  paid: ["ชำระเงิน (DEMO)", "Paid (DEMO)"],
  cancelled: ["ยกเลิก", "Cancelled"],
  expired: ["หมดเวลา", "Expired"],
  manual_confirm: ["ยืนยันการจองด้วยตนเอง (Owner)", "Confirmed manually (Owner)"],
});

export const actorRoleLabel: Record<string, string> = bilingual({
  owner: ["เจ้าของระบบ", "Owner"],
  admin: ["ผู้ดูแลระบบ", "Staff"],
  customer: ["ลูกค้า", "Customer"],
  system: ["ระบบ", "System"],
});

// ---------------------------------------------------------------------------
// Payments: cancellation is not a refund
// ---------------------------------------------------------------------------

export const refundStatusLabel: Record<string, string> = bilingual({
  none: ["-", "-"],
  not_refunded: [
    "ยกเลิกแล้ว · ไม่คืนเงิน (ค่าจองไม่คืนเมื่อยกเลิก ตามเงื่อนไขในสัญญา)",
    "Cancelled · not refunded (the booking fee is non-refundable under the contract)",
  ],
  refunded: ["ยกเลิกแล้ว · คืนเงินแล้ว (DEMO)", "Cancelled · refunded (DEMO)"],
});

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
    return tr(
      "กรุณาระบุเวลารับ-คืนรถให้ถูกต้อง (HH:MM)",
      "Please enter valid pickup and return times (HH:MM)",
    );
  if (!withinHours(f.pickupTime) || !withinHours(f.returnTime))
    return tr(
      `เวลารับรถและคืนรถต้องอยู่ระหว่าง ${OPENING_TIME}-${CLOSING_TIME} น.`,
      `Pickup and return times must be between ${OPENING_TIME} and ${CLOSING_TIME}.`,
    );
  if (startDate === endDate && f.returnTime <= f.pickupTime)
    return tr("เวลาคืนรถต้องหลังเวลารับรถ", "The return time must be after the pickup time");
  if (!Number.isFinite(f.deposit) || f.deposit < 0)
    return tr(
      "เงินประกันต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป",
      "The deposit must be a number of 0 or more",
    );
  if (!f.mileageAllowance.trim())
    return tr("กรุณาระบุข้อกำหนดระยะทาง", "Please enter the mileage terms");
  if (!f.latePenalty.trim())
    return tr("กรุณาระบุค่าปรับส่งคืนล่าช้า", "Please enter the late return penalty");
  return null;
}

/** Branch opening hours: pickup and return times must fall inside them. */
export const OPENING_TIME = "08:00";
export const CLOSING_TIME = "18:00";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const withinHours = (t: string) => HHMM.test(t) && t >= OPENING_TIME && t <= CLOSING_TIME;

/** Change requests a customer may make per contract; must match max_customer_revisions(). */
export const MAX_CUSTOMER_REVISIONS = 2;

/** How many change requests the customer has made (from the contract events). */
export const customerRevisionCount = (events: { action: string; actor_role: string }[]) =>
  events.filter((e) => e.action === "revision_requested" && e.actor_role === "customer").length;

/** What a customer can ask to change in a sent contract. */
export type RevisionRequest = { customerName: string; pickupTime: string; returnTime: string };

/** Thai error message, or null when the request is valid. */
export function revisionRequestError(r: RevisionRequest, sameDay: boolean): string | null {
  if (r.customerName.trim().length < 2)
    return tr("กรุณากรอกชื่อลูกค้า", "Please enter the customer name");
  if (!withinHours(r.pickupTime) || !withinHours(r.returnTime))
    return tr(
      `เวลารับรถและคืนรถต้องอยู่ระหว่าง ${OPENING_TIME}-${CLOSING_TIME} น.`,
      `Pickup and return times must be between ${OPENING_TIME} and ${CLOSING_TIME}.`,
    );
  if (sameDay && r.returnTime <= r.pickupTime)
    return tr("เวลาคืนรถต้องหลังเวลารับรถ", "The return time must be after the pickup time");
  return null;
}

/** True when the request asks for nothing new (same name and times as the sent version). */
export const revisionUnchanged = (original: RevisionRequest, r: RevisionRequest) =>
  r.customerName.trim() === original.customerName.trim() &&
  r.pickupTime.slice(0, 5) === original.pickupTime.slice(0, 5) &&
  r.returnTime.slice(0, 5) === original.returnTime.slice(0, 5);

/** Shown (and returned by customer_request_revision) when nothing was changed. */
export const REVISION_UNCHANGED_MESSAGE =
  "ยังไม่ได้แก้ไขข้อมูลใด กรุณาเปลี่ยนชื่อหรือเวลาที่ต้องการก่อนส่งคำขอ";

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
  reason.trim().length < min
    ? tr(
        `กรุณาระบุเหตุผลอย่างน้อย ${min} ตัวอักษร`,
        `Please give a reason of at least ${min} characters`,
      )
    : null;
