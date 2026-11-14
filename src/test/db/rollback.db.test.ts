// @vitest-environment node
/**
 * The level-1 rollback (docs/database/contract-approval-workflow-rollback.sql) restores the
 * old app behaviour without losing the new history. Real database (PGlite), fictional data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestDb,
  type TestUser,
  allCarIds,
  approvedContract,
  createAdmin,
  createBooking,
  createOwner,
  createTestDb,
  createUser,
  pay,
} from "./harness";

const ROLLBACK = path.resolve(
  __dirname,
  "../../../docs/database/contract-approval-workflow-rollback.sql",
);

let db: TestDb;
let admin: TestUser;
let alice: TestUser;
let suspended: TestUser;
let cars: string[];
let paidContract = "";

beforeAll(async () => {
  db = await createTestDb({ laterMigrations: false });
  const owner = await createOwner(db);
  admin = await createAdmin(db);
  suspended = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ" });
  cars = await allCarIds(db);
  // Some new-workflow history before rolling back
  const { booking, contractId } = await approvedContract(db, admin, alice, cars[0]!, 30);
  await pay(db, alice, booking.id, "qr");
  paidContract = contractId;
  await db
    .as(owner)
    .sql("select public.owner_set_admin_status($1, 'suspended', 'ทดสอบก่อนย้อนกลับ')", [
      suspended.id,
    ]);
  await db.exec(readFileSync(ROLLBACK, "utf8"));
}, 60000);
afterAll(() => db.close());

describe("rollback (level 1)", () => {
  it("keeps the new history", async () => {
    expect((await db.sql("select count(*)::int as n from public.contract_versions"))[0]!["n"]).toBe(
      1,
    );
    expect(
      (await db.sql("select count(*)::int as n from public.contract_events"))[0]!["n"],
    ).toBeGreaterThan(3);
    expect(
      (await db.sql("select count(*)::int as n from public.admin_audit_log"))[0]!["n"],
    ).toBeGreaterThan(0);
    const [c] = await db.sql(
      "select status, customer_accepted_at from public.contracts where id = $1",
      [paidContract],
    );
    expect(c!["status"]).toBe("accepted");
  });

  it("the old pay-first flow works again (pay_booking issues the contract)", async () => {
    const b = await createBooking(db, alice, cars[1]!, 40);
    await pay(db, alice, b.id, "qr");
    const [c] = await db.sql<{ status: string; terms: string }>(
      "select status, terms from public.contracts where booking_id = $1",
      [b.id],
    );
    expect(c!.status).toBe("active");
    expect(c!.terms).toContain("สัญญาเช่ารถยนต์");
    // the old app's accept and admin text edit are direct updates again
    await db
      .as(alice)
      .sql(
        "update public.contracts set status = 'accepted', customer_accepted_at = now() where booking_id = $1",
        [b.id],
      );
    await db
      .as(admin)
      .sql("update public.contracts set terms = terms || ' (แก้ไข)' where booking_id = $1", [b.id]);
    const [after] = await db.sql<{ status: string; terms: string }>(
      "select status, terms from public.contracts where booking_id = $1",
      [b.id],
    );
    expect(after).toMatchObject({ status: "accepted" });
    expect(after!.terms).toContain("(แก้ไข)");
  });

  it("the original has_role is back (suspension no longer applies) and the API functions are gone", async () => {
    expect(
      (await db.sql<{ r: boolean }>("select public.has_role($1, 'admin') as r", [suspended.id]))[0]!
        .r,
    ).toBe(true);
    await expect(
      db.as(admin).sql("select public.admin_send_contract(gen_random_uuid())"),
    ).rejects.toThrow(/does not exist/);
  });

  it("duplicate paid payments stay blocked", async () => {
    const [p] = await db.sql<{ booking_id: string }>(
      "select booking_id from public.payments limit 1",
    );
    await expect(
      db.sql(
        "insert into public.payments (booking_id, user_id, method, amount, status) values ($1, $2, 'qr', 1, 'paid')",
        [p!.booking_id, alice.id],
      ),
    ).rejects.toThrow(/payments_one_paid_per_booking/);
  });
});
