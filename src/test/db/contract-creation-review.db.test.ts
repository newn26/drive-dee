// @vitest-environment node
/**
 * Contract creation (C01-C11), customer review and data isolation (R01-R06).
 * Real database (PGlite), real roles and RLS. Fictional people only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestDb,
  type TestUser,
  adminCreate,
  adminUpdate,
  allCarIds,
  bookingRow,
  contractRow,
  createAdmin,
  createBooking,
  createTestDb,
  createUser,
  expireHold,
  send,
  terms,
} from "./harness";

let db: TestDb;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let cars: string[];
let slot = 0;
/** A booking that never overlaps another one in this file. */
const book = (who: TestUser, nights = 2) =>
  createBooking(
    db,
    who,
    cars[slot % cars.length]!,
    3 + 4 * Math.floor(slot++ / cars.length),
    nights,
  );

beforeAll(async () => {
  db = await createTestDb({ laterMigrations: false });
  admin = await createAdmin(db);
  alice = await createUser(db, {
    name: "ทดสอบ ลูกค้าเอ",
    phone: "000-000-0001",
    licence: "TEST-0001",
  });
  bob = await createUser(db, { name: "ทดสอบ ลูกค้าบี", phone: "000-000-0002" });
  await db.sql("update public.profiles set id_card_no = 'FAKE-ID-0000' where id = $1", [alice.id]);
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("contract creation", () => {
  it("C01 admin creates a draft contract for a valid pending booking", async () => {
    const b = await book(alice);
    const id = await adminCreate(db, admin, b.id, terms(b));
    const c = await contractRow(db, id);
    expect(c).toMatchObject({
      status: "draft",
      current_version: 1,
      sent_version: null,
      user_id: alice.id,
    });
    const [v] = await db.sql("select * from public.contract_versions where contract_id = $1", [id]);
    expect(v).toMatchObject({
      version: 1,
      customer_name: "ทดสอบ ลูกค้าเอ",
      customer_phone: "000-000-0001",
      sent_at: null,
    });
    expect(String(v!["rental_price"])).toBe(b.total_amount);
    expect(String(v!["terms"])).toContain("รับรถ:");
    // creating a contract is not a hand-off: the hold is unchanged
    expect((await bookingRow(db, b.id))["hold_expires_at"]).toEqual(b.hold_expires_at);
  });

  it("C02 a customer cannot create a contract", async () => {
    const b = await book(alice);
    await expect(adminCreate(db, alice, b.id, terms(b))).rejects.toThrow(/ไม่มีสิทธิ์ดำเนินการนี้/);
  });

  it("C03 an invalid booking id is rejected", async () => {
    const b = await book(alice);
    await expect(
      adminCreate(db, admin, "00000000-0000-0000-0000-000000000000", terms(b)),
    ).rejects.toThrow(/ไม่พบการจอง/);
  });

  it("C04 a second contract for the same booking is rejected", async () => {
    const b = await book(alice);
    await adminCreate(db, admin, b.id, terms(b));
    await expect(adminCreate(db, admin, b.id, terms(b))).rejects.toThrow(/มีสัญญาอยู่แล้ว/);
  });

  it("C05 cancelled or expired bookings are rejected", async () => {
    const cancelled = await book(alice);
    await db
      .as(alice)
      .sql("update public.bookings set status = 'cancelled' where id = $1", [cancelled.id]);
    await expect(adminCreate(db, admin, cancelled.id, terms(cancelled))).rejects.toThrow(
      /ไม่อยู่ในขั้นตอนทำสัญญา/,
    );

    const expired = await book(alice);
    await expireHold(db, expired.id);
    await expect(adminCreate(db, admin, expired.id, terms(expired))).rejects.toThrow(/หมดเวลา/);
  });

  it("C06 pickup/return must match the booking and return must be after pickup", async () => {
    const b = await book(alice);
    await expect(
      adminCreate(db, admin, b.id, terms(b, { pickup: `${b.end_date} 10:00:00+07` })),
    ).rejects.toThrow(/วันรับรถต้องตรงกับวันที่จอง/);

    const sameDay = await book(alice, 0);
    await expect(
      adminCreate(
        db,
        admin,
        sameDay.id,
        terms(sameDay, {
          pickup: `${sameDay.start_date} 18:00:00+07`,
          ret: `${sameDay.end_date} 10:00:00+07`,
        }),
      ),
    ).rejects.toThrow(/เวลาคืนรถต้องหลังเวลารับรถ/);
  });

  it("C07 customers cannot insert contracts or versions directly", async () => {
    const b = await book(alice);
    await expect(
      db
        .as(alice)
        .sql("insert into public.contracts (booking_id, user_id, terms) values ($1, $2, 'x')", [
          b.id,
          alice.id,
        ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db
        .as(alice)
        .sql(
          "insert into public.contract_versions (contract_id, version, terms) values (gen_random_uuid(), 1, 'x')",
        ),
    ).rejects.toThrow(/permission denied/);
  });

  it("C08 snapshot: no national ID; licence only when included", async () => {
    const cols = await db.sql<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'contract_versions'",
    );
    expect(cols.map((c) => c.column_name).some((c) => c.includes("id_card"))).toBe(false);

    const b = await book(alice);
    const id = await adminCreate(db, admin, b.id, terms(b, { licence: true }));
    const [v] = await db.sql<{ customer_license_no: string; terms: string }>(
      "select customer_license_no, terms from public.contract_versions where contract_id = $1",
      [id],
    );
    expect(v!.customer_license_no).toBe("TEST-0001");
    expect(v!.terms).toContain("TEST-0001");
    expect(v!.terms).not.toContain("FAKE-ID-0000");

    const noLicence = await book(alice);
    const id2 = await adminCreate(db, admin, noLicence.id, terms(noLicence));
    const [v2] = await db.sql(
      "select customer_license_no from public.contract_versions where contract_id = $1",
      [id2],
    );
    expect(v2!["customer_license_no"]).toBeNull();

    const bobBooking = await book(bob);
    await expect(
      adminCreate(db, admin, bobBooking.id, terms(bobBooking, { licence: true })),
    ).rejects.toThrow(/ยังไม่ได้กรอกเลขใบอนุญาตขับขี่/);
  });

  it("C09 customers never see an unsent draft", async () => {
    const b = await book(alice);
    const id = await adminCreate(db, admin, b.id, terms(b));
    expect(
      await db.as(alice).sql("select id from public.contracts where id = $1", [id]),
    ).toHaveLength(0);
    expect(
      await db
        .as(alice)
        .sql("select id from public.contract_versions where contract_id = $1", [id]),
    ).toHaveLength(0);
    expect(
      await db.as(alice).sql("select id from public.contract_events where contract_id = $1", [id]),
    ).toHaveLength(0);
  });

  it("C10 editing an unsent draft updates it in place", async () => {
    const b = await book(alice);
    const id = await adminCreate(db, admin, b.id, terms(b));
    expect(await adminUpdate(db, admin, id, terms(b, { deposit: 7000 }))).toBe(1);
    const versions = await db.sql(
      "select version, deposit from public.contract_versions where contract_id = $1",
      [id],
    );
    expect(versions).toHaveLength(1);
    expect(String(versions[0]!["deposit"])).toBe("7000.00");
  });

  it("C11 sending moves to pending_customer, mirrors the terms and resets the hold", async () => {
    const b = await book(alice);
    const id = await adminCreate(db, admin, b.id, terms(b));
    await send(db, admin, id);
    const c = await contractRow(db, id);
    const [v] = await db.sql<{ terms: string; sent_at: Date }>(
      "select terms, sent_at from public.contract_versions where contract_id = $1",
      [id],
    );
    expect(c).toMatchObject({ status: "pending_customer", sent_version: 1 });
    expect(c["terms"]).toBe(v!.terms);
    expect(v!.sent_at).toBeInstanceOf(Date);
    const [h] = await db.sql<{ mins: number }>(
      "select extract(epoch from hold_expires_at - now()) / 60 as mins from public.bookings where id = $1",
      [b.id],
    );
    expect(Number(h!.mins)).toBeGreaterThan(24 * 60 - 2);
  });
});

describe("customer review and isolation", () => {
  let contractId: string;
  beforeAll(async () => {
    const b = await book(alice);
    contractId = await adminCreate(db, admin, b.id, terms(b));
    await send(db, admin, contractId);
  });

  it("R01 the owner can read the sent contract, its versions and events", async () => {
    expect(
      await db.as(alice).sql("select id from public.contracts where id = $1", [contractId]),
    ).toHaveLength(1);
    expect(
      await db
        .as(alice)
        .sql("select id from public.contract_versions where contract_id = $1", [contractId]),
    ).toHaveLength(1);
    expect(
      (
        await db
          .as(alice)
          .sql("select id from public.contract_events where contract_id = $1", [contractId])
      ).length,
    ).toBeGreaterThan(0);
  });

  it("R02 another customer sees nothing", async () => {
    expect(
      await db.as(bob).sql("select id from public.contracts where id = $1", [contractId]),
    ).toHaveLength(0);
    expect(
      await db
        .as(bob)
        .sql("select id from public.contract_versions where contract_id = $1", [contractId]),
    ).toHaveLength(0);
    expect(
      await db
        .as(bob)
        .sql("select id from public.contract_events where contract_id = $1", [contractId]),
    ).toHaveLength(0);
  });

  it("R03 anonymous visitors cannot read contracts at all", async () => {
    await expect(db.as("anon").sql("select id from public.contracts")).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.as("anon").sql("select id from public.contract_versions")).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.as("anon").sql("select id from public.contract_events")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("R04 the customer cannot change contract terms or status directly", async () => {
    await expect(
      db
        .as(alice)
        .sql("update public.contracts set terms = 'tampered' where id = $1", [contractId]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db
        .as(alice)
        .sql("update public.contracts set status = 'approved' where id = $1", [contractId]),
    ).rejects.toThrow(/permission denied/);
    expect((await contractRow(db, contractId))["status"]).toBe("pending_customer");
  });

  it("R05 the customer cannot change a contract version directly", async () => {
    await expect(
      db
        .as(alice)
        .sql("update public.contract_versions set deposit = 0 where contract_id = $1", [
          contractId,
        ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("R06 the customer does not see internal draft events", async () => {
    const actions = await db
      .as(alice)
      .sql<{ action: string }>("select action from public.contract_events where contract_id = $1", [
        contractId,
      ]);
    expect(actions.map((a) => a.action)).toEqual(["sent"]);
    const all = await db.sql<{ action: string }>(
      "select action from public.contract_events where contract_id = $1 order by created_at",
      [contractId],
    );
    expect(all.map((a) => a.action)).toEqual(["created", "sent"]);
  });
});
