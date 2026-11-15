// @vitest-environment node
/**
 * Dropping the reviews table (docs/database/drop-reviews.sql) on the live stack
 * (0000-0007 + the docs/database SQL files). Real database (PGlite). Fictional data only.
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

beforeAll(async () => {
  db = await createTestDb({ applyLater: true });
  for (const f of [
    "revision-limits.sql",
    "pickup-day-status.sql",
    "pickup-payment.sql",
    "pickup-refund.sql",
    "pickup-at-handover.sql",
    "input-validation.sql",
    "booking-documents.sql",
  ])
    await db.exec(sql(f));
  await db.exec(sql("drop-reviews.sql"));
  await db.exec(sql("drop-reviews.sql")); // re-runnable
  admin = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ", licence: "TEST123456" });
  await db.sql("update public.profiles set id_card_no = '1101700230708' where id = $1", [alice.id]);
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("drop reviews", () => {
  it("the table and its policies are gone", async () => {
    expect(await db.sql("select to_regclass('public.reviews') as t")).toEqual([{ t: null }]);
    expect(await db.sql("select policyname from pg_policies where tablename = 'reviews'")).toEqual(
      [],
    );
  });

  it("booking, contract and booking fee still work", async () => {
    const b = await createBooking(db, alice, cars[0]!);
    const c = await adminCreate(db, admin, b.id, terms(b));
    await send(db, admin, c);
    await accept(db, alice, c, 1);
    await pay(db, alice, b.id, "qr");
    const [row] = await db.sql<{ status: string }>(
      "select status from public.bookings where id = $1",
      [b.id],
    );
    expect(row!.status).toBe("confirmed");
  });

  it("an admin can still delete a car that has no bookings", async () => {
    const [car] = await db.as(admin).sql<{ id: string }>(
      `insert into public.cars (brand, model, year, category, seats, transmission, fuel, plate_no,
         price_per_day, mileage) values ('Test', 'Car', 2022, 'sedan', 5, 'auto', 'petrol',
         'TEST-DROP', 1000, 0) returning id`,
    );
    await db.as(admin).sql("delete from public.cars where id = $1", [car!.id]);
    expect(await db.sql("select id from public.cars where id = $1", [car!.id])).toEqual([]);
  });
});
