/**
 * Contract workflow: statuses, labels and the rules the UI follows.
 *
 * Flow: the customer books → the contract is created at once (pending_customer) → the customer
 * accepts (approved = accepted, awaiting payment) → DEMO payment (paid). No Admin step.
 *
 * The database (drizzle 0004 + drizzle/migrations/0005_customer_self_accept_contract.sql) is the real
 * boundary: every transition below is enforced there too. These helpers only decide what the UI shows.
 * draft / pending_admin_review / revision_requested only remain for contracts from the old flow.
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
  pending_customer: "รอลูกค้ายอมรับ",
  pending_admin_review: "รอผู้ดูแลอนุมัติ (ระบบเดิม)",
  revision_requested: "ขอแก้ไขสัญญา (ระบบเดิม)",
  approved: "ลูกค้ายอมรับแล้ว · รอชำระเงิน",
  paid: "ชำระเงินแล้ว",
  cancelled: "ยกเลิก",
};

/** Labels for the customer. */
export function customerContractLabel(status: ContractStatus, everSent: boolean): string {
  if (status === "draft") return everSent ? "ต้องจองใหม่" : "กำลังจัดทำสัญญา";
  if (status === "pending_customer") return "รอคุณยอมรับสัญญา";
  if (status === "approved") return "ยอมรับแล้ว · รอชำระเงิน";
  if (status === "pending_admin_review" || status === "revision_requested") return "ต้องจองใหม่";
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

/** Payment is offered only once the customer has accepted the contract (approved), on an open booking. */
export const canPay = (
  b: BookingLike,
  c: ContractLike | null | undefined,
  now: number = Date.now(),
) => !!c && c.status === "approved" && holdActive(b, now);

/** The customer can accept only the version they were shown, while it is current. */
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

/** Which stage a pending booking is in, from the customer's point of view. */
export type CustomerStage =
  | "awaiting_contract"
  | "review_contract"
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
  if (!c) return "awaiting_contract";
  if (c.status === "pending_customer") return "review_contract";
  // Left over from the old Admin-review flow: the customer cancels and books again
  if (["draft", "pending_admin_review", "revision_requested"].includes(c.status))
    return "revision_requested";
  if (c.status === "approved") return "awaiting_payment";
  return "cancelled";
}

export const customerStageLabel: Record<CustomerStage, string> = {
  awaiting_contract: "รอสัญญา",
  review_contract: "รอยอมรับสัญญา",
  revision_requested: "ต้องจองใหม่",
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
  approved: "ผู้ดูแลอนุมัติสัญญา (ระบบเดิม)",
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

/** A reason for a revision request or a manual confirmation (same minimums as the database). */
export const reasonError = (reason: string, min: number) =>
  reason.trim().length < min ? `กรุณาระบุเหตุผลอย่างน้อย ${min} ตัวอักษร` : null;
