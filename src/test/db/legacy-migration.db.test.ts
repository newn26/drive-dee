// @vitest-environment node
/**
 * Existing data survives the migration (G01, M01, G05).
 * Legacy rows are created with the OLD functions (migrations 0000-0003) before the proposed
 * migration runs, the same way the live database got them. Fictional people only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestDb,
  type TestUser,
  allCarIds,
  createBooking,
  createTestDb,
  createUser,
} from "./harness";

let db: TestDb;
let customer: TestUser;
let oldAdmin: TestUser;
const ids = { a: "", b: "", c: "", d: "" };
let termsBefore: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb({
    beforeProposed: async (pre) => {
      customer = await createUser(pre, { name: "ทดสอบ ลูกค้าเดิม" });
      oldAdmin = await createUser(pre, {
        name: "ทดสอบ แอดมินเดิม",
        email: "old.admin@example.test",
      });
      await pre.sql("insert into public.user_roles (user_id, role) values ($1, 'admin')", [
        oldAdmin.id,
      ]);
      const cars = await allCarIds(pre);
      const payOld = async (bookingId: string) =>
        pre.as(customer).sql("select public.pay_booking($1, 'qr')", [bookingId]);

      // 1. paid, contract 'active' (never accepted)
      const a = await createBooking(pre, customer, cars[0]!, 3);
      await payOld(a.id);
      // 2. paid, contract accepted by the customer (old direct update)
      const b = await createBooking(pre, customer, cars[1]!, 3);
      await payOld(b.id);
      await pre
        .as(customer)
        .sql(
          "update public.contracts set status = 'accepted', customer_accepted_at = now() where booking_id = $1",
          [b.id],
        );
      // 3. paid, then cancelled by the customer
      const c = await createBooking(pre, customer, cars[2]!, 3);
      await payOld(c.id);
      await pre
        .as(customer)
        .sql("update public.bookings set status = 'cancelled' where id = $1", [c.id]);
      // 4. unpaid booking in progress
      const d = await createBooking(pre, customer, cars[3]!, 3);
      Object.assign(ids, { a: a.id, b: b.id, c: c.id, d: d.id });
      termsBefore = Object.fromEntries(
        (
          await pre.sql<{ booking_id: string; terms: string }>(
            "select booking_id, terms from public.contracts",
          )
        ).map((r) => [r.booking_id, r.terms]),
      );
    },
  });
}, 60000);
afterAll(() => db.close());

const contractFor = async (bookingId: string) =>
  (
    await db.sql<Record<string, unknown>>("select * from public.contracts where booking_id = $1", [
      bookingId,
    ])
  )[0]!;

describe("legacy data", () => {
  it("G01 existing contracts are kept, mapped and given an immutable version 1", async () => {
    expect(await contractFor(ids.a)).toMatchObject({
      status: "paid",
      current_version: 1,
      sent_version: 1,
      customer_accepted_at: null,
    });
    const accepted = await contractFor(ids.b);
    expect(accepted).toMatchObject({ status: "paid" });
    expect(accepted["customer_accepted_at"]).toBeInstanceOf(Date);
    expect(await contractFor(ids.c)).toMatchObject({ status: "cancelled" });
    for (const [bookingId, before] of Object.entries(termsBefore)) {
      expect((await contractFor(bookingId))["terms"]).toBe(before);
    }
    const versions = await db.sql<Record<string, unknown>>(
      "select * from public.contract_versions order by created_at",
    );
    expect(versions).toHaveLength(3);
    expect(
      versions.every((v) => v["is_legacy"] === true && v["version"] === 1 && v["sent_at"] !== null),
    ).toBe(true);
    const acceptedVersion = versions.find((v) => v["accepted_at"] !== null);
    expect(acceptedVersion!["accepted_by"]).toBe(customer.id);
    expect(
      await db.sql(
        "select count(*)::int as n from public.contract_events where action = 'legacy_import'",
      ),
    ).toEqual([{ n: 3 }]);
    // a legacy version is as immutable as a new one
    await expect(
      db.sql("update public.contract_versions set terms = 'x' where is_legacy"),
    ).rejects.toThrow(/แก้ไขไม่ได้/);
  });

  it("G01b payments and bookings are unchanged; the cancelled paid booking is marked not refunded", async () => {
    const payments = await db.sql<{ booking_id: string; status: string; refund_status: string }>(
      "select booking_id, status, refund_status from public.payments",
    );
    expect(payments).toHaveLength(3);
    expect(payments.every((p) => p.status === "paid")).toBe(true);
    expect(payments.find((p) => p.booking_id === ids.c)!.refund_status).toBe("not_refunded");
    expect(payments.filter((p) => p.refund_status === "none")).toHaveLength(2);
    const statuses = await db.sql<{ id: string; status: string }>(
      "select id, status from public.bookings",
    );
    expect(statuses.find((s) => s.id === ids.a)!.status).toBe("confirmed");
    expect(statuses.find((s) => s.id === ids.d)!.status).toBe("pending");
  });

  it("G01c an unpaid booking keeps today's 15-minute rule", async () => {
    const [r] = await db.sql<{ ok: boolean }>(
      "select hold_expires_at = created_at + interval '15 minutes' as ok from public.bookings where id = $1",
      [ids.d],
    );
    expect(r!.ok).toBe(true);
  });

  it("G01d the customer still sees their legacy contracts", async () => {
    expect(await db.as(customer).sql("select id from public.contracts")).toHaveLength(3);
    expect(await db.as(customer).sql("select id from public.contract_versions")).toHaveLength(3);
  });

  it("M01 existing admins stay admins with every permission and are NOT made Owner", async () => {
    const [m] = await db.sql<Record<string, unknown>>(
      "select * from public.admin_members where user_id = $1",
      [oldAdmin.id],
    );
    expect(m).toMatchObject({ status: "active", is_owner: false, email: "old.admin@example.test" });
    expect(m!["permissions"]).toEqual([
      "contracts_manage",
      "contracts_approve",
      "bookings_manage",
      "fleet_manage",
      "reviews_moderate",
    ]);
    expect(await db.sql("select 1 from public.admin_members where is_owner")).toHaveLength(0);
    expect(await db.as(oldAdmin).sql("select id from public.contracts")).toHaveLength(3);
    // Owner-only actions are unavailable until the separate bootstrap step
    await expect(
      db
        .as(oldAdmin)
        .sql("select public.owner_manual_confirm_booking($1, 'เหตุผลยาวพอสำหรับทดสอบ')", [ids.d]),
    ).rejects.toThrow(/เฉพาะเจ้าของระบบ/);
  });

  it("G05 reviews still work for customers with a confirmed booking", async () => {
    const [car] = await db.sql<{ car_id: string }>(
      "select car_id from public.bookings where id = $1",
      [ids.a],
    );
    await db
      .as(customer)
      .sql(
        "insert into public.reviews (booking_id, car_id, user_id, reviewer_name, rating, comment) values ($1, $2, $3, 'ทดสอบ ล.', 5, 'ดีมาก')",
        [ids.a, car!.car_id, customer.id],
      );
    expect(await db.as("anon").sql("select rating from public.reviews")).toEqual([{ rating: 5 }]);
    // A customer cannot delete reviews; an admin with reviews_moderate can
    await db.as(customer).sql("delete from public.reviews");
    expect(await db.sql("select id from public.reviews")).toHaveLength(1);
    await db.as(oldAdmin).sql("delete from public.reviews");
    expect(await db.sql("select id from public.reviews")).toHaveLength(0);
  });

  it("G05b the customer can still edit their own profile", async () => {
    await db
      .as(customer)
      .sql("update public.profiles set phone = '000-111-2222' where id = $1", [customer.id]);
    expect(
      (await db.sql("select phone from public.profiles where id = $1", [customer.id]))[0]!["phone"],
    ).toBe("000-111-2222");
  });
});
