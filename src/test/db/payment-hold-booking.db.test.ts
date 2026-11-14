// @vitest-environment node
/**
 * Payment (P01-P12), booking hold and expiry (E01-E08), admin booking-status bypass (B01-B05).
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
  bkkDate,
  bookingRow,
  contractRow,
  createAdmin,
  createBooking,
  createOwner,
  createTestDb,
  createUser,
  expireHold,
  pay,
  send,
  terms,
} from "./harness";

let db: TestDb;
let owner: TestUser;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let cars: string[];
let slot = 0;
/** Non-overlapping start offset (days from today) for each new booking in this file. */
const nextOffset = () => 3 + 4 * slot++;
const car0 = () => cars[0]!;
const book = (who: TestUser) => createBooking(db, who, car0(), nextOffset());
const approved = (who: TestUser = alice) => approvedContract(db, admin, who, car0(), nextOffset());
const paymentsFor = (bookingId: string) =>
  db.sql<Record<string, unknown>>("select * from public.payments where booking_id = $1", [
    bookingId,
  ]);
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
  owner = await createOwner(db);
  admin = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ" });
  bob = await createUser(db, { name: "ทดสอบ ลูกค้าบี" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("payment", () => {
  it("P01 cannot pay a booking that has no contract", async () => {
    const b = await book(alice);
    await expect(pay(db, alice, b.id, "qr")).rejects.toThrow(/ต้องรอผู้ดูแลอนุมัติสัญญาก่อน/);
  });

  it("P02 cannot pay in draft, pending_customer, pending_admin_review or revision_requested", async () => {
    const b = await book(alice);
    const id = await adminCreate(db, admin, b.id, terms(b));
    await expect(pay(db, alice, b.id, "qr")).rejects.toThrow(/ต้องรอผู้ดูแลอนุมัติสัญญาก่อน/); // draft
    await send(db, admin, id);
    await expect(pay(db, alice, b.id, "qr")).rejects.toThrow(/ต้องรอผู้ดูแลอนุมัติสัญญาก่อน/); // pending_customer
    await accept(db, alice, id, 1);
    await expect(pay(db, alice, b.id, "qr")).rejects.toThrow(/ต้องรอผู้ดูแลอนุมัติสัญญาก่อน/); // pending_admin_review
    await db.as(admin).sql("select public.admin_request_revision($1, 1, 'ขอแก้ไขเงื่อนไข')", [id]);
    await expect(pay(db, alice, b.id, "qr")).rejects.toThrow(/ต้องรอผู้ดูแลอนุมัติสัญญาก่อน/); // revision_requested
    expect(await paymentsFor(b.id)).toHaveLength(0);
  });

  it("P03 QR DEMO payment after approval confirms booking and marks the contract paid", async () => {
    const { booking, contractId } = await approved();
    const [p] = await pay(db, alice, booking.id, "qr");
    expect(p!.id).toBeTruthy();
    const [row] = await paymentsFor(booking.id);
    expect(row).toMatchObject({
      method: "qr",
      status: "paid",
      card_last4: null,
      refund_status: "none",
    });
    expect(String(row!["reference"])).toMatch(/^DEMO-[0-9A-F]{10}$/);
    expect(await bookingRow(db, booking.id)).toMatchObject({
      status: "confirmed",
      hold_expires_at: null,
    });
    const c = await contractRow(db, contractId);
    expect(c["status"]).toBe("paid");
    expect(c["paid_at"]).toBeInstanceOf(Date);
    const ev = await db.sql<{ note: string }>(
      "select note from public.contract_events where contract_id = $1 and action = 'paid'",
      [contractId],
    );
    expect(ev[0]!.note).toContain(String(row!["reference"]));
  });

  it("P04 card DEMO payment after approval stores only the last 4 digits", async () => {
    const { booking } = await approved();
    await pay(db, alice, booking.id, "card", "4242");
    expect((await paymentsFor(booking.id))[0]).toMatchObject({
      method: "card",
      card_last4: "4242",
    });
  });

  it("P05 invalid card data is rejected and nothing is written", async () => {
    const { booking, contractId } = await approved();
    await expect(pay(db, alice, booking.id, "card", "42")).rejects.toThrow(/ข้อมูลบัตรไม่ถูกต้อง/);
    expect(await paymentsFor(booking.id)).toHaveLength(0);
    expect((await contractRow(db, contractId))["status"]).toBe("approved");
  });

  it("P07 duplicate successful payments are rejected (function and database index)", async () => {
    const { booking } = await approved();
    await pay(db, alice, booking.id, "qr");
    await expect(pay(db, alice, booking.id, "qr")).rejects.toThrow(/ชำระเงินแล้วหรือถูกยกเลิก/);
    await expect(
      db.sql(
        `insert into public.payments (booking_id, user_id, method, amount, status, reference)
         values ($1, $2, 'qr', 1, 'paid', 'DEMO-DUPLICATE')`,
        [booking.id, alice.id],
      ),
    ).rejects.toThrow(/payments_one_paid_per_booking/);
    expect(await paymentsFor(booking.id)).toHaveLength(1);
  });

  it("P08 payment after the 15-minute window is rejected", async () => {
    const { booking } = await approved();
    await expireHold(db, booking.id);
    await expect(pay(db, alice, booking.id, "qr")).rejects.toThrow(/หมดเวลาชำระเงิน/);
  });

  it("P09 a cancelled booking cannot be paid", async () => {
    const { booking } = await approved();
    await db
      .as(alice)
      .sql("update public.bookings set status = 'cancelled' where id = $1", [booking.id]);
    await expect(pay(db, alice, booking.id, "qr")).rejects.toThrow(/ชำระเงินแล้วหรือถูกยกเลิก/);
  });

  it("P10 a customer cannot pay someone else's booking", async () => {
    const { booking } = await approved();
    await expect(pay(db, bob, booking.id, "qr")).rejects.toThrow(/ไม่พบการจอง/);
  });

  it("P11 a failed payment leaves no payment and an unpaid contract", async () => {
    const { booking, contractId } = await approved();
    await expect(pay(db, alice, booking.id, "card", null as unknown as string)).rejects.toThrow();
    expect(await paymentsFor(booking.id)).toHaveLength(0);
    expect((await contractRow(db, contractId))["status"]).toBe("approved");
    expect((await bookingRow(db, booking.id))["status"]).toBe("pending");
  });

  it("P12 the amount charged is the approved version's price, which is the booking total", async () => {
    const { booking, contractId } = await approved();
    await pay(db, alice, booking.id, "qr");
    const [v] = await db.sql(
      "select rental_price from public.contract_versions where contract_id = $1",
      [contractId],
    );
    const [p] = await paymentsFor(booking.id);
    expect(String(p!["amount"])).toBe(String(v!["rental_price"]));
    expect(String(p!["amount"])).toBe(booking.total_amount);
  });
});

describe("booking hold and expiry", () => {
  it("E01 a new booking holds the car for 24 hours (stage 1)", async () => {
    const b = await book(alice);
    const m = await holdMinutes(b.id);
    expect(m).toBeGreaterThan(24 * 60 - 2);
    expect(m).toBeLessThanOrEqual(24 * 60);
  });

  it("E02 an expired hold stops blocking immediately, with no cleanup run", async () => {
    const car = cars[1]!;
    const a = await createBooking(db, alice, car, 10);
    await expireHold(db, a.id);
    const free = await db
      .as(bob)
      .sql<{ id: string }>("select public.booked_car_ids($1::date, $2::date) as id", [
        a.start_date,
        a.end_date,
      ]);
    expect(free.map((r) => r.id)).not.toContain(car);
    const b = await createBooking(db, bob, car, 10);
    expect(b.id).toBeTruthy();
    expect((await bookingRow(db, a.id))["status"]).toBe("pending"); // nothing cancelled it
  });

  it("E03 an active hold blocks search and overlapping bookings", async () => {
    const car = cars[2]!;
    const a = await createBooking(db, alice, car, 10);
    const held = await db
      .as(bob)
      .sql<{ id: string }>("select public.booked_car_ids($1::date, $2::date) as id", [
        a.start_date,
        a.end_date,
      ]);
    expect(held.map((r) => r.id)).toContain(car);
    await expect(createBooking(db, bob, car, 11)).rejects.toThrow(/ถูกจองในช่วงวันที่เลือกแล้ว/);
  });

  it("E04 every hand-off resets the hold; approval starts the 15-minute window", async () => {
    const b = await book(alice);
    const id = await adminCreate(db, admin, b.id, terms(b));
    const set = (mins: number) =>
      db.sql(
        `with f as (select set_config('app.contract_workflow', 'on', true) as x)
         update public.bookings set hold_expires_at = now() + make_interval(mins => $2) where id = $1 and exists (select 1 from f)`,
        [b.id, mins],
      );
    const stages: [string, () => Promise<unknown>][] = [
      ["send", () => send(db, admin, id)],
      [
        "customer revision",
        () =>
          db.as(alice).sql("select public.customer_request_revision($1, 1, 'ขอแก้ไขเวลา')", [id]),
      ],
      ["new version", () => adminUpdate(db, admin, id, terms(b, { deposit: 1 }))],
      ["send v2", () => send(db, admin, id)],
      ["accept", () => accept(db, alice, id, 2)],
      [
        "admin revision",
        () =>
          db.as(admin).sql("select public.admin_request_revision($1, 2, 'แก้ไขอีกครั้ง')", [id]),
      ],
    ];
    for (const [name, step] of stages) {
      await set(30);
      await step();
      expect(await holdMinutes(b.id), name).toBeGreaterThan(24 * 60 - 2);
    }
    await adminUpdate(db, admin, id, terms(b, { deposit: 2 }));
    await send(db, admin, id);
    await accept(db, alice, id, 3);
    await approve(db, admin, id, 3);
    const m = await holdMinutes(b.id);
    expect(m).toBeGreaterThan(14);
    expect(m).toBeLessThanOrEqual(15);
  });

  it("E05 review stages never hold past the end of the pickup day", async () => {
    const b = await createBooking(db, alice, cars[3]!, 0, 0); // pickup today
    const [cap] = await db.sql<{ cap: Date }>(
      "select (((now() at time zone 'Asia/Bangkok')::date + 1)::timestamp at time zone 'Asia/Bangkok') as cap",
    );
    expect(
      new Date(String((await bookingRow(db, b.id))["hold_expires_at"])).getTime(),
    ).toBeLessThanOrEqual(new Date(cap!.cap).getTime());
  });

  it("E06 nobody can move a hold directly", async () => {
    const b = await book(alice);
    const before = (await bookingRow(db, b.id))["hold_expires_at"];
    await db
      .as(alice)
      .sql(
        "update public.bookings set hold_expires_at = now() + interval '30 days' where id = $1",
        [b.id],
      );
    await db
      .as(admin)
      .sql(
        "update public.bookings set hold_expires_at = now() + interval '30 days' where id = $1",
        [b.id],
      );
    expect((await bookingRow(db, b.id))["hold_expires_at"]).toEqual(before);
  });

  it("E07 expire_stale_bookings cancels only expired holds, cancels their contracts, and is idempotent", async () => {
    const stale = await book(alice);
    const id = await adminCreate(db, admin, stale.id, terms(stale));
    await send(db, admin, id);
    await expireHold(db, stale.id);
    const fresh = await book(alice);

    const [r] = await db.as(bob).sql<{ n: number }>("select public.expire_stale_bookings() as n");
    expect(Number(r!.n)).toBeGreaterThanOrEqual(1);
    expect((await bookingRow(db, stale.id))["status"]).toBe("cancelled");
    expect((await bookingRow(db, fresh.id))["status"]).toBe("pending");
    expect((await contractRow(db, id))["status"]).toBe("cancelled");
    const ev = await db.sql(
      "select actor_role, actor_id from public.contract_events where contract_id = $1 and action = 'expired'",
      [id],
    );
    expect(ev).toEqual([{ actor_role: "system", actor_id: null }]);
    const [again] = await db
      .as(bob)
      .sql<{ n: number }>("select public.expire_stale_bookings() as n");
    expect(Number(again!.n)).toBe(0);
  });

  it("E08 every workflow step rejects an expired hold", async () => {
    const b = await book(alice);
    const id = await adminCreate(db, admin, b.id, terms(b));
    await expireHold(db, b.id);
    await expect(send(db, admin, id)).rejects.toThrow(/หมดเวลา/);
    await expect(adminUpdate(db, admin, id, terms(b))).rejects.toThrow(/หมดเวลา/);

    const b2 = await book(alice);
    const id2 = await adminCreate(db, admin, b2.id, terms(b2));
    await send(db, admin, id2);
    await expireHold(db, b2.id);
    await expect(accept(db, alice, id2, 1)).rejects.toThrow(/หมดเวลา/);
    await expect(
      db.as(alice).sql("select public.customer_request_revision($1, 1, 'ขอแก้ไขเวลา')", [id2]),
    ).rejects.toThrow(/หมดเวลา/);

    const b3 = await book(alice);
    const id3 = await adminCreate(db, admin, b3.id, terms(b3));
    await send(db, admin, id3);
    await accept(db, alice, id3, 1);
    await expireHold(db, b3.id);
    await expect(approve(db, admin, id3, 1)).rejects.toThrow(/หมดเวลา/);
    await expect(
      db.as(admin).sql("select public.admin_request_revision($1, 1, 'แก้ไขเงื่อนไข')", [id3]),
    ).rejects.toThrow(/หมดเวลา/);
  });
});

describe("admin booking status", () => {
  it("B01 an admin cannot confirm a booking without payment", async () => {
    const b = await book(alice);
    await expect(
      db.as(admin).sql("update public.bookings set status = 'confirmed' where id = $1", [b.id]),
    ).rejects.toThrow(/ยืนยันการจองได้หลังผู้ดูแลอนุมัติสัญญาและลูกค้าชำระเงินแล้วเท่านั้น/);
  });

  it("B02 the Owner can manually confirm with a reason, and it is audited", async () => {
    const b = await book(alice);
    const reason = "ลูกค้าชำระเงินสดที่สาขา (ทดสอบ)";
    await db.as(owner).sql("select public.owner_manual_confirm_booking($1, $2)", [b.id, reason]);
    expect((await bookingRow(db, b.id))["status"]).toBe("confirmed");
    const ev = await db.sql(
      "select actor_role, actor_id, note from public.contract_events where booking_id = $1 and action = 'manual_confirm'",
      [b.id],
    );
    expect(ev).toEqual([{ actor_role: "owner", actor_id: owner.id, note: reason }]);
    const audit = await db.sql<{ actor_id: string; details: { reason: string } }>(
      "select actor_id, details from public.admin_audit_log where action = 'booking_manual_confirm' and details->>'booking_id' = $1",
      [b.id],
    );
    expect(audit[0]).toMatchObject({ actor_id: owner.id, details: { reason } });
    expect(await paymentsFor(b.id)).toHaveLength(0); // no payment invented
  });

  it("B03 manual confirm needs a reason, the Owner, and a free car", async () => {
    const b = await book(alice);
    await expect(
      db.as(owner).sql("select public.owner_manual_confirm_booking($1, 'สั้น')", [b.id]),
    ).rejects.toThrow(/กรุณาระบุเหตุผล/);
    await expect(
      db
        .as(admin)
        .sql("select public.owner_manual_confirm_booking($1, $2)", [
          b.id,
          "เหตุผลยาวพอสำหรับทดสอบ",
        ]),
    ).rejects.toThrow(/เฉพาะเจ้าของระบบ/);
    await expect(
      db
        .as(alice)
        .sql("select public.owner_manual_confirm_booking($1, $2)", [
          b.id,
          "เหตุผลยาวพอสำหรับทดสอบ",
        ]),
    ).rejects.toThrow(/เฉพาะเจ้าของระบบ/);

    const car = cars[4]!;
    const first = await createBooking(db, alice, car, 20);
    await expireHold(db, first.id);
    await createBooking(db, bob, car, 20); // takes the freed dates
    await expect(
      db
        .as(owner)
        .sql("select public.owner_manual_confirm_booking($1, $2)", [
          first.id,
          "เหตุผลยาวพอสำหรับทดสอบ",
        ]),
    ).rejects.toThrow(/จองซ้อน/);
  });

  it("B04 normal admin status moves still work; reopening is blocked", async () => {
    const { booking } = await approved();
    await pay(db, alice, booking.id, "qr");
    await db
      .as(admin)
      .sql("update public.bookings set status = 'active' where id = $1", [booking.id]);
    await db
      .as(admin)
      .sql("update public.bookings set status = 'completed' where id = $1", [booking.id]);
    await expect(
      db.as(admin).sql("update public.bookings set status = 'pending' where id = $1", [booking.id]),
    ).rejects.toThrow(/ไม่มีสิทธิ์เปลี่ยนสถานะ/);
  });

  it("B05 cancelling cancels the contract; a paid booking keeps its payment, marked not refunded", async () => {
    const b = await book(alice);
    const id = await adminCreate(db, admin, b.id, terms(b));
    await send(db, admin, id);
    await db.as(alice).sql("update public.bookings set status = 'cancelled' where id = $1", [b.id]);
    expect((await contractRow(db, id))["status"]).toBe("cancelled");

    const { booking, contractId } = await approved();
    await pay(db, alice, booking.id, "qr");
    await db
      .as(alice)
      .sql("update public.bookings set status = 'cancelled' where id = $1", [booking.id]);
    const [p] = await paymentsFor(booking.id);
    expect(p).toMatchObject({ status: "paid", refund_status: "not_refunded" });
    const c = await contractRow(db, contractId);
    expect(c["status"]).toBe("cancelled");
    expect(c["paid_at"]).toBeInstanceOf(Date);
    const [ev] = await db.sql<{ note: string }>(
      "select note from public.contract_events where contract_id = $1 and action = 'cancelled'",
      [contractId],
    );
    expect(ev!.note).toContain("ยังไม่มีการคืนเงิน");
  });

  it("B06 a booking customer cannot change someone else's booking", async () => {
    const b = await book(alice);
    // RLS hides the row from bob, so nothing changes
    await db.as(bob).sql("update public.bookings set status = 'cancelled' where id = $1", [b.id]);
    expect((await bookingRow(db, b.id))["status"]).toBe("pending");
  });
});

describe("booking dates helper sanity", () => {
  it("uses Bangkok dates", async () => {
    expect(await bkkDate(db, 0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
