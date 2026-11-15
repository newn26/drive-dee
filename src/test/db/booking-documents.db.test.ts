// @vitest-environment node
/**
 * Booking documents + receipt details (docs/database/booking-documents.sql) on the live
 * stack (0000-0007 + the docs/database SQL it builds on). Real database (PGlite).
 * Fictional people and document numbers only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestDb,
  type TestUser,
  adminCreate,
  allCarIds,
  createAdmin,
  createBooking,
  createTestDb,
  createUser,
  terms,
} from "./harness";

const sql = (f: string) =>
  readFileSync(path.resolve(__dirname, "../../../docs/database", f), "utf8");

// Fictional: passes the Thai ID check digit but is not a real person's number
const FAKE_ID = "1101700230708";
const FAKE_LICENCE = "TEST123456";

let db: TestDb;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let cars: string[];
let slot = 0;

const setDocs = (u: TestUser, id: string, licence: string) =>
  db.sql("update public.profiles set id_card_no = $2, license_no = $3 where id = $1", [
    u.id,
    id,
    licence,
  ]);
const receipt = (who: TestUser, bookingId: string) =>
  db
    .as(who)
    .sql<Record<string, string | null>>("select * from public.booking_receipt_details($1)", [
      bookingId,
    ]);

beforeAll(async () => {
  db = await createTestDb({ applyLater: true });
  for (const f of ["revision-limits.sql", "pickup-day-status.sql", "input-validation.sql"])
    await db.exec(sql(f));
  await db.exec(sql("booking-documents.sql"));
  await db.exec(sql("booking-documents.sql")); // re-runnable
  admin = await createAdmin(db);
  await db.sql("update public.profiles set full_name = 'ทดสอบ แอดมินผู้สร้าง' where id = $1", [
    admin.id,
  ]);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ", phone: "0812345678" });
  bob = await createUser(db, { name: "ทดสอบ ลูกค้าบี" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("ID card and driver's licence are required to book", () => {
  it("a customer with neither cannot book", async () => {
    await expect(createBooking(db, alice, cars[slot++]!)).rejects.toThrow(/ก่อนจองรถ/);
  });

  it("a licence without an ID card (or the reverse) is still refused", async () => {
    const licenceOnly = await createUser(db, { licence: FAKE_LICENCE });
    await expect(createBooking(db, licenceOnly, cars[slot++]!)).rejects.toThrow(/ก่อนจองรถ/);
    const idOnly = await createUser(db);
    await db.sql("update public.profiles set id_card_no = $2 where id = $1", [idOnly.id, FAKE_ID]);
    await expect(createBooking(db, idOnly, cars[slot++]!)).rejects.toThrow(/ก่อนจองรถ/);
  });

  it("with both the booking goes through", async () => {
    await setDocs(alice, FAKE_ID, FAKE_LICENCE);
    await expect(createBooking(db, alice, cars[slot++]!)).resolves.toHaveProperty("id");
  });
});

describe("receipt details", () => {
  it("returns the customer's details and the admin who created the contract", async () => {
    await db.sql("update public.profiles set address = 'ที่อยู่สมมติ 1' where id = $1", [alice.id]);
    const b = await createBooking(db, alice, cars[slot++]!);

    const [before] = await receipt(alice, b.id);
    expect(before!["contract_created_by_name"]).toBeNull();

    await adminCreate(db, admin, b.id, terms(b));
    const [r] = await receipt(alice, b.id);
    expect(r).toMatchObject({
      customer_name: "ทดสอบ ลูกค้าเอ",
      customer_email: alice.email,
      customer_phone: "0812345678",
      customer_address: "ที่อยู่สมมติ 1",
      customer_id_card_no: FAKE_ID,
      customer_license_no: FAKE_LICENCE,
      contract_created_by_name: "ทดสอบ แอดมินผู้สร้าง",
    });
    expect(r!["contract_no"]).toBeTruthy();

    // Admins see the same receipt
    const [asAdmin] = await receipt(admin, b.id);
    expect(asAdmin!["customer_email"]).toBe(alice.email);
  });

  it("another customer cannot read someone else's receipt", async () => {
    const b = await createBooking(db, alice, cars[slot++]!);
    await expect(receipt(bob, b.id)).rejects.toThrow(/ไม่พบการจองนี้/);
  });
});
