// @vitest-environment node
/**
 * Cancelling after the pickup payment (docs/database/pickup-refund.sql on top of
 * pickup-payment.sql) on the live stack. Only the 1,000 THB fee is kept.
 * Real database (PGlite). Fictional people only.
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
let cars: string[];
let slot = 0;

async function feePaid(startOffset = 3) {
  const b = await createBooking(db, alice, cars[slot++]!, startOffset, 1);
  const c = await adminCreate(db, admin, b.id, terms(b));
  await send(db, admin, c);
  await accept(db, alice, c, 1);
  await pay(db, alice, b.id, "qr");
  return { b, c };
}
const payPickup = (id: string) =>
  db.as(alice).sql("select public.pay_pickup($1, 'qr'::payment_method, null)", [id]);
const setStatus = (who: TestUser, id: string, status: string) =>
  db.as(who).sql("update public.bookings set status = $2 where id = $1", [id, status]);
const refunds = async (id: string) =>
  Object.fromEntries(
    (
      await db.sql<{ kind: string; refund_status: string }>(
        "select kind, refund_status from public.payments where booking_id = $1 and status = 'paid'",
        [id],
      )
    ).map((r) => [r.kind, r.refund_status]),
  );

beforeAll(async () => {
  db = await createTestDb({ applyLater: true });
  for (const f of [
    "revision-limits.sql",
    "pickup-day-status.sql",
    "pickup-payment.sql",
    "pickup-refund.sql",
    "pickup-refund.sql", // re-runnable
  ])
    await db.exec(sql(f));
  admin = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("cancelling after paying online", () => {
  it("fee only: the fee is kept", async () => {
    const { b } = await feePaid();
    await setStatus(alice, b.id, "cancelled");
    expect(await refunds(b.id)).toEqual({ booking_fee: "not_refunded" });
  });

  it("fee + the rest: the fee is kept, the rest is refunded, and the history says so", async () => {
    const { b, c } = await feePaid();
    await payPickup(b.id);
    await setStatus(alice, b.id, "cancelled");
    expect(await refunds(b.id)).toEqual({ booking_fee: "not_refunded", pickup: "refunded" });
    const [ev] = await db.sql<{ note: string }>(
      "select note from public.contract_events where contract_id = $1 and action = 'cancelled'",
      [c],
    );
    expect(ev!.note).toMatch(/ไม่คืนค่าจอง คืนยอดที่ชำระเพิ่ม/);
  });

  it("an admin cancelling a confirmed booking refunds the rest too", async () => {
    const { b } = await feePaid();
    await payPickup(b.id);
    await setStatus(admin, b.id, "cancelled");
    expect(await refunds(b.id)).toEqual({ booking_fee: "not_refunded", pickup: "refunded" });
  });

  it("a rental already in progress (active) refunds nothing automatically", async () => {
    const { b } = await feePaid(0);
    await payPickup(b.id);
    await setStatus(admin, b.id, "active");
    await setStatus(admin, b.id, "cancelled");
    expect(await refunds(b.id)).toEqual({ booking_fee: "not_refunded", pickup: "not_refunded" });
  });
});
