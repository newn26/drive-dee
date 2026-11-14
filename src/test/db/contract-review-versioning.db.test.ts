// @vitest-environment node
/**
 * Customer acceptance (A01-A06), admin review (D01-D07) and versioning/revisions (V01-V11).
 * Real database (PGlite), real roles and RLS. Fictional people only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestDb,
  type TestUser,
  accept,
  adminCreate,
  adminUpdate,
  allCarIds,
  approve,
  approvedContract,
  contractRow,
  createAdmin,
  createBooking,
  createTestDb,
  createUser,
  expireHold,
  pay,
  send,
  terms,
} from "./harness";

let db: TestDb;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let demo: TestUser;
let cars: string[];
let slot = 0;
const book = (who: TestUser) =>
  createBooking(db, who, cars[slot % cars.length]!, 3 + 4 * Math.floor(slot++ / cars.length));

/** Booking + contract sent to the customer. */
async function sent(who: TestUser = alice) {
  const booking = await book(who);
  const id = await adminCreate(db, admin, booking.id, terms(booking));
  await send(db, admin, id);
  return { booking, id };
}

const versions = (id: string) =>
  db.sql<Record<string, unknown>>(
    "select * from public.contract_versions where contract_id = $1 order by version",
    [id],
  );
const holdMinutes = async (bookingId: string) =>
  Number(
    (
      await db.sql<{ m: number }>(
        "select extract(epoch from hold_expires_at - now()) / 60 as m from public.bookings where id = $1",
        [bookingId],
      )
    )[0]!.m,
  );

beforeAll(async () => {
  db = await createTestDb();
  admin = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ" });
  bob = await createUser(db, { name: "ทดสอบ ลูกค้าบี" });
  demo = await createUser(db, {
    name: "ทดสอบ เดโม",
    email: "demo-x@demo.siamwheels.invalid",
    demo: true,
  });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("customer acceptance", () => {
  it("A01 accepting the current version records it on that version and moves to admin review", async () => {
    const { booking, id } = await sent();
    await accept(db, alice, id, 1);
    const [v] = await versions(id);
    expect(v!["accepted_by"]).toBe(alice.id);
    expect(v!["accepted_at"]).toBeInstanceOf(Date);
    const c = await contractRow(db, id);
    expect(c["status"]).toBe("pending_admin_review");
    expect(c["customer_accepted_at"]).toBeInstanceOf(Date);
    const ev = await db.sql<{ action: string; actor_role: string; version: number }>(
      "select action, actor_role, version from public.contract_events where contract_id = $1 and action = 'accepted'",
      [id],
    );
    expect(ev).toEqual([{ action: "accepted", actor_role: "customer", version: 1 }]);
    expect(await holdMinutes(booking.id)).toBeGreaterThan(24 * 60 - 2);
  });

  it("A02 accepting a version number that is not current is rejected", async () => {
    const { id } = await sent();
    await expect(accept(db, alice, id, 2)).rejects.toThrow(/ไม่ใช่ฉบับล่าสุด/);
  });

  it("A03 another customer cannot accept (and learns nothing)", async () => {
    const { id } = await sent();
    await expect(accept(db, bob, id, 1)).rejects.toThrow(/ไม่พบสัญญา/);
  });

  it("A04 cancelled contracts and expired holds cannot be accepted", async () => {
    const cancelled = await sent();
    await db
      .as(alice)
      .sql("update public.bookings set status = 'cancelled' where id = $1", [cancelled.booking.id]);
    await expect(accept(db, alice, cancelled.id, 1)).rejects.toThrow(
      /ไม่อยู่ในสถานะรอลูกค้ายอมรับ/,
    );

    const expired = await sent();
    await expireHold(db, expired.booking.id);
    await expect(accept(db, alice, expired.id, 1)).rejects.toThrow(/หมดเวลา/);
  });

  it("A05 accepting twice is rejected", async () => {
    const { id } = await sent();
    await accept(db, alice, id, 1);
    await expect(accept(db, alice, id, 1)).rejects.toThrow(/ไม่อยู่ในสถานะรอลูกค้ายอมรับ/);
  });

  it("A06 an admin cannot accept on the customer's behalf", async () => {
    const { id } = await sent();
    await expect(accept(db, admin, id, 1)).rejects.toThrow(/ไม่พบสัญญา/);
  });
});

describe("admin review", () => {
  it("D01 approving the accepted version starts the 15-minute payment window", async () => {
    const { booking, id } = await sent();
    await accept(db, alice, id, 1);
    await approve(db, admin, id, 1);
    const c = await contractRow(db, id);
    expect(c).toMatchObject({ status: "approved", approved_by: admin.id });
    const [v] = await versions(id);
    expect(v!["approved_by"]).toBe(admin.id);
    const m = await holdMinutes(booking.id);
    expect(m).toBeGreaterThan(14);
    expect(m).toBeLessThanOrEqual(15);
  });

  it("D02 customers and demo accounts cannot approve", async () => {
    const { id } = await sent();
    await accept(db, alice, id, 1);
    await expect(approve(db, alice, id, 1)).rejects.toThrow(/ไม่มีสิทธิ์ดำเนินการนี้/);
    await expect(approve(db, demo, id, 1)).rejects.toThrow(/ไม่มีสิทธิ์ดำเนินการนี้/);
    expect((await contractRow(db, id))["status"]).toBe("pending_admin_review");
  });

  it("D03 a contract the customer has not accepted cannot be approved", async () => {
    const { id } = await sent();
    await expect(approve(db, admin, id, 1)).rejects.toThrow(
      /อนุมัติได้เฉพาะสัญญาที่ลูกค้ายอมรับแล้ว/,
    );
  });

  it("D04 approving the wrong version number is rejected", async () => {
    const { id } = await sent();
    await accept(db, alice, id, 1);
    await expect(approve(db, admin, id, 2)).rejects.toThrow(/ไม่ใช่ฉบับล่าสุด/);
  });

  it("D05 admin can request a revision with a reason", async () => {
    const { booking, id } = await sent();
    await accept(db, alice, id, 1);
    await db
      .as(admin)
      .sql("select public.admin_request_revision($1, 1, $2)", [id, "แก้เวลารับรถเป็น 09:00"]);
    expect(await contractRow(db, id)).toMatchObject({
      status: "revision_requested",
      revision_reason: "แก้เวลารับรถเป็น 09:00",
      revision_requested_by: "admin",
    });
    expect(await holdMinutes(booking.id)).toBeGreaterThan(24 * 60 - 2);
  });

  it("D06 a revision request needs a reason", async () => {
    const { id } = await sent();
    await accept(db, alice, id, 1);
    await expect(
      db.as(admin).sql("select public.admin_request_revision($1, 1, '  ')", [id]),
    ).rejects.toThrow(/กรุณาระบุเหตุผล/);
  });

  it("D07 customers cannot use any admin contract function", async () => {
    const { booking, id } = await sent();
    await accept(db, alice, id, 1);
    await expect(
      db.as(alice).sql("select public.admin_request_revision($1, 1, 'ขอแก้ไขเอง')", [id]),
    ).rejects.toThrow(/ไม่มีสิทธิ์/);
    await expect(send(db, alice, id)).rejects.toThrow(/ไม่มีสิทธิ์/);
    await expect(adminUpdate(db, alice, id, terms(booking))).rejects.toThrow(/ไม่มีสิทธิ์/);
  });
});

describe("revisions and versioning", () => {
  it("V01 the customer can request a revision with a reason", async () => {
    const { booking, id } = await sent();
    await expect(
      db.as(alice).sql("select public.customer_request_revision($1, 1, 'สั้น')", [id]),
    ).rejects.toThrow(/กรุณาระบุเหตุผล/);
    await db
      .as(alice)
      .sql("select public.customer_request_revision($1, 1, $2)", [id, "ขอเปลี่ยนเวลาคืนรถ"]);
    expect(await contractRow(db, id)).toMatchObject({
      status: "revision_requested",
      revision_requested_by: "customer",
    });
    expect(await holdMinutes(booking.id)).toBeGreaterThan(24 * 60 - 2);
  });

  it("V02 a new version supersedes the old one and keeps its acceptance intact", async () => {
    const { booking, id } = await sent();
    await accept(db, alice, id, 1);
    await db
      .as(admin)
      .sql("select public.admin_request_revision($1, 1, $2)", [id, "แก้เงินประกัน"]);
    const before = (await versions(id))[0]!;
    expect(await adminUpdate(db, admin, id, terms(booking, { deposit: 3000 }))).toBe(2);
    const [v1, v2] = await versions(id);
    expect(v1!["superseded_at"]).toBeInstanceOf(Date);
    expect(v1!["accepted_at"]).toEqual(before["accepted_at"]);
    expect(v1!["terms"]).toBe(before["terms"]);
    expect(v2).toMatchObject({ version: 2, sent_at: null, accepted_at: null, approved_at: null });
    expect(await contractRow(db, id)).toMatchObject({
      status: "draft",
      current_version: 2,
      sent_version: 1,
      customer_accepted_at: null,
    });
  });

  it("V03 a revised version must be accepted again before approval", async () => {
    const { booking, id } = await sent();
    await accept(db, alice, id, 1);
    await adminUpdate(db, admin, id, terms(booking, { deposit: 2000 }));
    await send(db, admin, id);
    await expect(approve(db, admin, id, 2)).rejects.toThrow(
      /อนุมัติได้เฉพาะสัญญาที่ลูกค้ายอมรับแล้ว/,
    );
    await accept(db, alice, id, 2);
    await approve(db, admin, id, 2);
    expect((await contractRow(db, id))["status"]).toBe("approved");
  });

  it("V04 an old acceptance can never approve a new version", async () => {
    const { booking, id } = await sent();
    await accept(db, alice, id, 1);
    await adminUpdate(db, admin, id, terms(booking, { deposit: 1000 }));
    await expect(approve(db, admin, id, 1)).rejects.toThrow();
    await expect(approve(db, admin, id, 2)).rejects.toThrow();
    await send(db, admin, id);
    await expect(accept(db, alice, id, 1)).rejects.toThrow(/ไม่ใช่ฉบับล่าสุด/);
    await expect(approve(db, admin, id, 2)).rejects.toThrow();
    const [, v2] = await versions(id);
    expect(v2!["accepted_at"]).toBeNull();
  });

  it("V05 a sent version's content cannot be changed, even by the database owner", async () => {
    const { id } = await sent();
    await expect(
      db.sql("update public.contract_versions set deposit = 0 where contract_id = $1", [id]),
    ).rejects.toThrow(/แก้ไขไม่ได้/);
  });

  it("V06 a sent version cannot be deleted", async () => {
    const { id } = await sent();
    await expect(
      db.sql("delete from public.contract_versions where contract_id = $1", [id]),
    ).rejects.toThrow(/ไม่สามารถลบ/);
  });

  it("V07 acceptance and approval stamps are write-once", async () => {
    const { id } = await sent();
    await accept(db, alice, id, 1);
    await expect(
      db.sql(
        "update public.contract_versions set accepted_at = now() - interval '1 day' where contract_id = $1",
        [id],
      ),
    ).rejects.toThrow(/แก้ไขไม่ได้/);
  });

  it("V08 only one live (non-superseded) version per contract", async () => {
    const { id } = await sent();
    await expect(
      db.sql(
        "insert into public.contract_versions (contract_id, version, is_legacy, terms) values ($1, 9, true, 'x')",
        [id],
      ),
    ).rejects.toThrow(/contract_versions_one_live/);
  });

  it("V09 editing after approval (before payment) resets approval and blocks payment", async () => {
    const { booking, contractId } = await approvedContract(
      db,
      admin,
      alice,
      cars[0]!,
      200 + 4 * slot++,
    );
    expect(await adminUpdate(db, admin, contractId, terms(booking, { deposit: 4000 }))).toBe(2);
    expect(await contractRow(db, contractId)).toMatchObject({
      status: "draft",
      approved_at: null,
      approved_by: null,
    });
    await expect(pay(db, alice, booking.id, "qr")).rejects.toThrow(/ต้องรอผู้ดูแลอนุมัติสัญญาก่อน/);
  });

  it("V10 a paid contract cannot be edited", async () => {
    const { booking, contractId } = await approvedContract(
      db,
      admin,
      alice,
      cars[0]!,
      200 + 4 * slot++,
    );
    await pay(db, alice, booking.id, "qr");
    await expect(adminUpdate(db, admin, contractId, terms(booking))).rejects.toThrow(/แก้ไขไม่ได้/);
  });

  it("V11 contract events are append-only", async () => {
    const { id } = await sent();
    await expect(
      db.sql("update public.contract_events set note = 'x' where contract_id = $1", [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.sql("delete from public.contract_events where contract_id = $1", [id]),
    ).rejects.toThrow(/append-only/);
  });
});
