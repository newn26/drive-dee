// @vitest-environment node
/**
 * The rest (rent + deposit - fee) can be paid only after the admin marks the booking "active"
 * (docs/database/pickup-at-handover.sql) on the live stack. Real database (PGlite).
 * Fictional people only.
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
  pay,
  send,
  terms,
} from "./harness";

const sql = (f: string) =>
  readFileSync(path.resolve(__dirname, "../../../docs/database", f), "utf8");

let db: TestDb;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let cars: string[];
let slot = 0;

/** A booking whose fee is paid (confirmed), pickup `startOffset` days from today. */
async function feePaid(startOffset = 0) {
  const b = await createBooking(db, alice, cars[slot++]!, startOffset, 1);
  const c = await adminCreate(db, admin, b.id, terms(b));
  await send(db, admin, c);
  await accept(db, alice, c, 1);
  await pay(db, alice, b.id, "qr");
  return b;
}
const payPickup = (who: TestUser, id: string) =>
  db.as(who).sql("select public.pay_pickup($1, 'qr'::payment_method, null)", [id]);
const setStatus = (who: TestUser, id: string, status: string) =>
  db.as(who).sql("update public.bookings set status = $2 where id = $1", [id, status]);

beforeAll(async () => {
  db = await createTestDb({ applyLater: true });
  for (const f of [
    "revision-limits.sql",
    "pickup-day-status.sql",
    "pickup-payment.sql",
    "pickup-refund.sql",
    "pickup-at-handover.sql",
    "pickup-at-handover.sql", // re-runnable
  ])
    await db.exec(sql(f));
  admin = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ" });
  bob = await createUser(db, { name: "ทดสอบ ลูกค้าบี" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("pickup payment after hand-over", () => {
  it("after the fee only, the rest cannot be paid yet", async () => {
    const b = await feePaid();
    await expect(payPickup(alice, b.id)).rejects.toThrow(/ผู้ดูแลยืนยันว่าคุณมารับรถแล้ว/);
  });

  it("once the admin marks the car handed over, the customer pays rent + deposit - fee once", async () => {
    const b = await feePaid();
    await setStatus(admin, b.id, "active");
    await expect(payPickup(bob, b.id)).rejects.toThrow(/ไม่พบการจอง/);
    await payPickup(alice, b.id);
    await expect(payPickup(alice, b.id)).rejects.toThrow(/ชำระยอดวันรับรถแล้ว/);
    const rent = Number(b.total_amount);
    const [p] = await db.sql<{ amount: string; deposit: string }>(
      "select amount::text, deposit::text from public.payments where booking_id = $1 and kind = 'pickup'",
      [b.id],
    );
    expect([Number(p!.amount), Number(p!.deposit)]).toEqual([rent * 2 - 1000, rent]);
  });

  it("a cancelled or completed booking cannot pay the rest", async () => {
    const cancelled = await feePaid(2);
    await setStatus(alice, cancelled.id, "cancelled");
    await expect(payPickup(alice, cancelled.id)).rejects.toThrow(/มารับรถแล้ว/);
    const done = await feePaid();
    await setStatus(admin, done.id, "active");
    await setStatus(admin, done.id, "completed");
    await expect(payPickup(alice, done.id)).rejects.toThrow(/มารับรถแล้ว/);
  });
});
