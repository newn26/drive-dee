import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ADMIN_BOOKING_MOVES,
  CONTRACT_STATUSES,
  CONTRACT_TRANSITIONS,
  canCustomerRespond,
  canPay,
  canTransition,
  customerContractLabel,
  customerStage,
  reasonError,
} from "@/lib/contract-workflow";

const SQL = readFileSync(
  path.resolve(__dirname, "../../drizzle/migrations/0004_contract_approval_workflow.sql"),
  "utf8",
);
/** 0005: its guard_contract_update() replaces the one in 0004. */
const SELF_ACCEPT_SQL = readFileSync(
  path.resolve(__dirname, "../../drizzle/migrations/0005_customer_self_accept_contract.sql"),
  "utf8",
);
const NOW = new Date("2026-11-12T10:00:00Z").getTime();
const later = new Date(NOW + 10 * 60_000).toISOString();
const earlier = new Date(NOW - 60_000).toISOString();
const contract = (status: string, current = 1, sent: number | null = 1) => ({
  status,
  current_version: current,
  sent_version: sent,
});

describe("S01 the UI state machine matches the database", () => {
  it("allows exactly the transitions guard_contract_update() allows", () => {
    const block =
      /guard_contract_update[\s\S]*?array\[([\s\S]*?)\]\)\)/.exec(SELF_ACCEPT_SQL)?.[1] ?? "";
    const fromSql = [...block.matchAll(/'([a-z_]+)>([a-z_]+)'/g)]
      .map((m) => `${m[1]}>${m[2]}`)
      .sort();
    const fromTs = CONTRACT_STATUSES.flatMap((from) =>
      CONTRACT_TRANSITIONS[from].map((to) => `${from}>${to}`),
    ).sort();
    expect(fromSql.length).toBeGreaterThan(10);
    expect(fromTs).toEqual(fromSql);
  });

  it("lists the same statuses as the contracts_status_check constraint", () => {
    const check = /contracts_status_check check \(status in\s*\(([^)]*)\)/.exec(SQL)?.[1] ?? "";
    const fromSql = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...CONTRACT_STATUSES].sort()).toEqual(fromSql);
  });

  it("never offers pending → confirmed as a manual booking move", () => {
    expect(ADMIN_BOOKING_MOVES["pending"]).toEqual(["cancelled"]);
    expect(Object.values(ADMIN_BOOKING_MOVES).flat()).not.toContain("pending");
    expect(canTransition("paid", "draft")).toBe(false);
    expect(canTransition("approved", "paid")).toBe(true);
    expect(canTransition("pending_customer", "approved")).toBe(true);
  });
});

describe("customer stage and gating", () => {
  const pending = { status: "pending", hold_expires_at: later };

  it("maps every contract status to a customer stage", () => {
    expect(customerStage(pending, null)).toBe("awaiting_contract");
    expect(customerStage(pending, contract("draft", 1, null))).toBe("revision_requested");
    expect(customerStage(pending, contract("pending_customer"))).toBe("review_contract");
    expect(customerStage(pending, contract("pending_admin_review"))).toBe("revision_requested");
    expect(customerStage(pending, contract("revision_requested"))).toBe("revision_requested");
    expect(customerStage(pending, contract("approved"))).toBe("awaiting_payment");
    expect(customerStage({ status: "confirmed" }, contract("paid"))).toBe("confirmed");
    expect(customerStage({ status: "cancelled" }, contract("approved"))).toBe("cancelled");
  });

  it("P13 payment is offered only once the customer accepted (approved), with time left", () => {
    for (const s of [
      "draft",
      "pending_customer",
      "pending_admin_review",
      "revision_requested",
      "paid",
      "cancelled",
    ]) {
      expect(canPay(pending, contract(s), NOW), s).toBe(false);
    }
    expect(canPay(pending, null, NOW)).toBe(false);
    expect(canPay(pending, contract("approved"), NOW)).toBe(true);
    expect(canPay({ status: "pending", hold_expires_at: earlier }, contract("approved"), NOW)).toBe(
      false,
    );
    expect(canPay({ status: "cancelled", hold_expires_at: later }, contract("approved"), NOW)).toBe(
      false,
    );
  });

  it("the customer can respond only to the current sent version", () => {
    expect(canCustomerRespond(pending, contract("pending_customer"), NOW)).toBe(true);
    expect(canCustomerRespond(pending, contract("pending_customer", 2, 1), NOW)).toBe(false);
    expect(canCustomerRespond(pending, contract("pending_admin_review"), NOW)).toBe(false);
    expect(
      canCustomerRespond(
        { status: "pending", hold_expires_at: earlier },
        contract("pending_customer"),
        NOW,
      ),
    ).toBe(false);
  });

  it("customer wording", () => {
    expect(customerContractLabel("draft", false)).toBe("กำลังจัดทำสัญญา");
    expect(customerContractLabel("pending_customer", true)).toBe("รอคุณยอมรับสัญญา");
    expect(customerContractLabel("approved", true)).toBe("ยอมรับแล้ว · รอชำระเงิน");
    expect(customerContractLabel("pending_admin_review", true)).toBe("ต้องจองใหม่");
  });
});

describe("reasons", () => {
  it("requires a minimum length", () => {
    expect(reasonError("สั้น", 5)).toMatch(/อย่างน้อย 5/);
    expect(reasonError("เหตุผลยาวพอ", 5)).toBeNull();
  });
});
