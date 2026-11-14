// @vitest-environment node
/**
 * Booking fee flow (docs/database/booking-fee-flow.sql), applied on top of 0004.
 * Book → admin sends the draft → customer asks for changes or confirms → pay 1,000 THB
 * within 15 minutes (no admin approval after the customer confirms).
 * Real database (PGlite), real roles and RLS. Fictional people only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestDb,
  type TestUser,
  accept,
  adminCreate,
  allCarIds,
  createAdmin,
  createBooking,
  createTestDb,
  createUser,
  expireHold,
  pay,
  send,
  terms,
} from "./harness";

const FLOW_SQL = readFileSync(
  path.resolve(__dirname, "../../../docs/database/booking-fee-flow.sql"),
  "utf8",
);

let db: TestDb;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let cars: string[];
let slot = 0;

const one = async <T = Record<string, unknown>>(q: string, p: unknown[]) =>
  (await db.sql<T>(q, p))[0]!;
const holdMinutes = async (bookingId: string) =>
  Number(
    (
      await one<{ m: number }>(
        "select extract(epoch from hold_expires_at - now()) / 60 as m from public.bookings where id = $1",
        [bookingId],
      )
    ).m,
  );

/** Booking (3 days) with a sent draft contract. */
async function sentDraft(who: TestUser = alice) {
  const booking = await createBooking(db, who, cars[slot++]!, 3, 2);
  const contractId = await adminCreate(db, admin, booking.id, terms(booking, { deposit: 5000 }));
  await send(db, admin, contractId);
  return { booking, contractId };
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(FLOW_SQL);
  await db.exec(FLOW_SQL); // idempotent
  admin = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ" });
  bob = await createUser(db, { name: "ทดสอบ ลูกค้าบี" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("booking fee flow", () => {
  it("before the customer confirms a sent draft, payment is refused", async () => {
    const booking = await createBooking(db, alice, cars[slot++]!, 3, 2);
    await expect(pay(db, alice, booking.id, "qr")).rejects.toThrow("กรุณายืนยันสัญญาก่อน");
    const { booking: b2 } = await sentDraft();
    await expect(pay(db, alice, b2.id, "qr")).rejects.toThrow("กรุณายืนยันสัญญาก่อน");
  });

  it("the draft shows deposit = rent and the amount due at pickup", async () => {
    const { contractId } = await sentDraft();
    const v = await one<{ deposit: string; rental_price: string; terms: string }>(
      "select deposit::text, rental_price::text, terms from public.contract_versions where contract_id = $1",
      [contractId],
    );
    const rent = Number(v.rental_price);
    expect(Number(v.deposit)).toBe(rent); // the admin's 5,000 is ignored
    const due = (rent * 2 - 1000).toLocaleString("en-US", { minimumFractionDigits: 2 });
    expect(v.terms).toContain(`ยอดชำระ ณ วันรับรถ (ค่าเช่า + เงินประกัน - ค่าจอง): ${due} บาท`);
    expect(v.terms).toContain("ค่าจอง (ชำระออนไลน์หลังยืนยันสัญญา): 1,000.00 บาท");
  });

  it("confirming opens a 15-minute window with no admin approval, then paying charges 1,000", async () => {
    const { booking, contractId } = await sentDraft();
    await accept(db, alice, contractId, 1);
    const c = await one<{ status: string }>("select status from public.contracts where id = $1", [
      contractId,
    ]);
    expect(c.status).toBe("approved");
    const m = await holdMinutes(booking.id);
    expect(m).toBeGreaterThan(13);
    expect(m).toBeLessThanOrEqual(15.1);

    await pay(db, alice, booking.id, "card", "4242");
    const p = await one<{ amount: string }>(
      "select amount::text from public.payments where booking_id = $1",
      [booking.id],
    );
    expect(Number(p.amount)).toBe(1000);
    const after = await one<{ b: string; c: string }>(
      "select b.status as b, c.status as c from public.bookings b join public.contracts c on c.booking_id = b.id where b.id = $1",
      [booking.id],
    );
    expect(after).toEqual({ b: "confirmed", c: "paid" });
  });

  it("the customer can ask for changes; the new version must be confirmed before paying", async () => {
    const { booking, contractId } = await sentDraft();
    await db
      .as(alice)
      .sql("select public.customer_request_revision($1, 1, $2)", [contractId, "ขอรับรถ 09:00 น."]);
    await expect(pay(db, alice, booking.id, "qr")).rejects.toThrow("กรุณายืนยันสัญญาก่อน");
    await db
      .as(admin)
      .sql(
        "select public.admin_update_contract($1, $2, $3, 0, 'ไม่จำกัดระยะทาง', '500 บาท / ชั่วโมง', '', false)",
        [contractId, `${booking.start_date} 09:00:00+07`, `${booking.end_date} 18:00:00+07`],
      );
    await send(db, admin, contractId);
    await expect(accept(db, alice, contractId, 1)).rejects.toThrow("ไม่ใช่ฉบับล่าสุด");
    await accept(db, alice, contractId, 2);
    await pay(db, alice, booking.id, "qr");
  });

  it("cannot pay twice, after 15 minutes, or for someone else", async () => {
    const a = await sentDraft();
    await accept(db, alice, a.contractId, 1);
    await expect(pay(db, bob, a.booking.id, "qr")).rejects.toThrow("ไม่พบการจอง");
    await pay(db, alice, a.booking.id, "qr");
    await expect(pay(db, alice, a.booking.id, "qr")).rejects.toThrow("ชำระเงินแล้ว");

    const late = await sentDraft();
    await accept(db, alice, late.contractId, 1);
    await expireHold(db, late.booking.id);
    await expect(pay(db, alice, late.booking.id, "qr")).rejects.toThrow("หมดเวลาชำระเงิน");
  });

  it("cancelling a paid booking keeps the fee (not refunded)", async () => {
    const { booking, contractId } = await sentDraft();
    await accept(db, alice, contractId, 1);
    await pay(db, alice, booking.id, "qr");
    await db
      .as(alice)
      .sql("update public.bookings set status = 'cancelled' where id = $1", [booking.id]);
    const p = await one<{ refund_status: string }>(
      "select refund_status from public.payments where booking_id = $1",
      [booking.id],
    );
    expect(p.refund_status).toBe("not_refunded");
  });
});
