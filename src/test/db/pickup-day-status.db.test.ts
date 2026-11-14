// @vitest-environment node
/**
 * Hand-over / return only from the pickup day (docs/database/pickup-day-status.sql) on the
 * live stack (0000-0007 + revision-limits). Real database (PGlite). Fictional people only.
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
  bookingRow,
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

/** A paid (confirmed) booking whose pickup is `startOffset` days from today. */
async function confirmed(startOffset: number) {
  const b = await createBooking(db, alice, cars[slot++]!, startOffset, 1);
  const c = await adminCreate(db, admin, b.id, terms(b));
  await send(db, admin, c);
  await accept(db, alice, c, 1);
  await pay(db, alice, b.id, "qr");
  return b;
}
const setStatus = (who: TestUser, id: string, status: string) =>
  db.as(who).sql("update public.bookings set status = $2 where id = $1", [id, status]);

beforeAll(async () => {
  db = await createTestDb({ applyLater: true });
  await db.exec(sql("revision-limits.sql"));
  await db.exec(sql("pickup-day-status.sql"));
  await db.exec(sql("pickup-day-status.sql")); // re-runnable
  admin = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("pickup day", () => {
  it("before the pickup day the car cannot be handed over or returned", async () => {
    const b = await confirmed(3);
    await expect(setStatus(admin, b.id, "active")).rejects.toThrow(/ได้ตั้งแต่วันรับรถ/);
    await expect(setStatus(admin, b.id, "completed")).rejects.toThrow(/ได้ตั้งแต่วันรับรถ/);
    expect((await bookingRow(db, b.id))["status"]).toBe("confirmed");
  });

  it("before the pickup day it can still be cancelled", async () => {
    const b = await confirmed(3);
    await setStatus(admin, b.id, "cancelled");
    expect((await bookingRow(db, b.id))["status"]).toBe("cancelled");
  });

  it("on the pickup day: hand over, then return", async () => {
    const b = await confirmed(0);
    await setStatus(admin, b.id, "active");
    expect((await bookingRow(db, b.id))["status"]).toBe("active");
    await setStatus(admin, b.id, "completed");
    expect((await bookingRow(db, b.id))["status"]).toBe("completed");
  });

  it("the earlier rules still hold (no unpaid confirm, customers cannot hand over)", async () => {
    const b = await createBooking(db, alice, cars[slot++]!, 0, 1);
    await expect(setStatus(admin, b.id, "confirmed")).rejects.toThrow();
    const paid = await confirmed(0);
    await expect(setStatus(alice, paid.id, "active")).rejects.toThrow(/ไม่มีสิทธิ์/);
  });
});
