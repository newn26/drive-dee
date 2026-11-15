// @vitest-environment node
/**
 * Input validation (docs/database/input-validation.sql) on the live stack
 * (0000-0007 + revision-limits.sql): car price and bounds, profile field formats, and
 * revision requests that change nothing. Real database (PGlite). Fictional people only.
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
  send,
  terms,
} from "./harness";
import { REVISION_UNCHANGED_MESSAGE, revisionReasonText } from "@/lib/contract-workflow";

const sql = (file: string) =>
  readFileSync(path.resolve(__dirname, "../../../docs/database", file), "utf8");

let db: TestDb;
let admin: TestUser;
let alice: TestUser;
let cars: string[];
let slot = 0;

beforeAll(async () => {
  db = await createTestDb({ applyLater: true });
  await db.exec(sql("revision-limits.sql"));
  await db.exec(sql("input-validation.sql"));
  await db.exec(sql("input-validation.sql")); // re-runnable
  admin = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

const newCar = (price: number, over: { year?: number; seats?: number; mileage?: number } = {}) =>
  db.as(admin).sql(
    `insert into public.cars (brand, model, year, category, seats, transmission, fuel, plate_no,
       price_per_day, mileage) values ('Test', 'Car', $1, 'sedan', $2, 'auto', 'petrol', $3, $4, $5)
     returning id`,
    [over.year ?? 2022, over.seats ?? 5, `TEST-${Math.random()}`, price, over.mileage ?? 0],
  );

describe("B1 car price", () => {
  it("an admin cannot add a car at -100 or 0 THB per day", async () => {
    await expect(newCar(-100)).rejects.toThrow(/cars_price_positive/);
    await expect(newCar(0)).rejects.toThrow(/cars_price_positive/);
    await expect(newCar(1200)).resolves.toHaveLength(1);
  });

  it("an admin cannot change an existing car to a negative price", async () => {
    await expect(
      db.as(admin).sql("update public.cars set price_per_day = -100 where id = $1", [cars[0]]),
    ).rejects.toThrow(/cars_price_positive/);
  });

  it("seats, mileage and year have sane bounds", async () => {
    await expect(newCar(1000, { seats: 0 })).rejects.toThrow(/cars_seats_range/);
    await expect(newCar(1000, { mileage: -1 })).rejects.toThrow(/cars_mileage_nonnegative/);
    await expect(newCar(1000, { year: 1800 })).rejects.toThrow(/cars_year_range/);
  });
});

describe("B2-4 profile fields", () => {
  const save = (u: TestUser, fields: Record<string, string>) => {
    const cols = Object.keys(fields);
    return db
      .as(u)
      .sql(
        `update public.profiles set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`,
        [u.id, ...Object.values(fields)],
      );
  };

  it("valid phone, Thai ID, passport and licence are accepted", async () => {
    const u = await createUser(db);
    await save(u, { phone: "081-234-5678", id_card_no: "1101700230708", license_no: "64001234" });
    await save(u, { id_card_no: "AA1234567" });
  });

  it("rejects an empty licence, phone 'abc12' and ID '123'", async () => {
    const u = await createUser(db, { licence: "64001234" });
    await expect(save(u, { license_no: "" })).rejects.toThrow(/กรุณากรอกหมายเลขใบอนุญาตขับขี่/);
    await expect(save(u, { phone: "abc12" })).rejects.toThrow(/เบอร์โทรศัพท์ไม่ถูกต้อง/);
    await expect(save(u, { id_card_no: "123" })).rejects.toThrow(/เลขบัตรประชาชน/);
    await expect(save(u, { id_card_no: "1101700230709" })).rejects.toThrow(/เลขบัตรประชาชน/); // bad checksum
  });

  it("signup and edits to other fields still work when an old value is odd", async () => {
    const u = await createUser(db, { phone: "000-000-0000" }); // signup trigger is not blocked
    await save(u, { full_name: "ทดสอบ ชื่อใหม่", address: "กรุงเทพฯ" });
  });
});

describe("B5 revision request with no change", () => {
  async function sentDraft() {
    const booking = await createBooking(db, alice, cars[1 + slot++]!, 3, 2);
    const contractId = await adminCreate(db, admin, booking.id, terms(booking)); // 10:00-18:00
    await send(db, admin, contractId);
    return contractId;
  }
  const request = (contractId: string, name: string, pickup: string, ret: string) =>
    db
      .as(alice)
      .sql("select public.customer_request_revision($1, 1, $2)", [
        contractId,
        revisionReasonText({ customerName: name, pickupTime: pickup, returnTime: ret }),
      ]);
  const customerRequests = async (contractId: string) =>
    (
      await db.sql<{ n: string }>(
        `select count(*)::text as n from public.contract_events
         where contract_id = $1 and action = 'revision_requested' and actor_role = 'customer'`,
        [contractId],
      )
    )[0]!.n;

  it("the same name and times are rejected and do not use up a request", async () => {
    const contractId = await sentDraft();
    await expect(request(contractId, "ทดสอบ ลูกค้าเอ", "10:00", "18:00")).rejects.toThrow(
      REVISION_UNCHANGED_MESSAGE,
    );
    await expect(request(contractId, "  ทดสอบ ลูกค้าเอ ", "10:00", "18:00")).rejects.toThrow(
      REVISION_UNCHANGED_MESSAGE,
    );
    expect(await customerRequests(contractId)).toBe("0");
    const [c] = await db.sql<{ status: string }>(
      "select status from public.contracts where id = $1",
      [contractId],
    );
    expect(c!.status).toBe("pending_customer");
  });

  it("changing any one field is accepted", async () => {
    await request(await sentDraft(), "ทดสอบ ลูกค้าเอ", "09:00", "18:00");
    await request(await sentDraft(), "ทดสอบ ลูกค้าเอ", "10:00", "17:00");
    const contractId = await sentDraft();
    await request(contractId, "ทดสอบ ชื่อใหม่", "10:00", "18:00");
    expect(await customerRequests(contractId)).toBe("1");
  });
});
