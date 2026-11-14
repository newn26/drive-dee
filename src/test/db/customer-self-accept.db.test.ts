// @vitest-environment node
/**
 * Customer self-accept flow (docs/database/customer-self-accept-contract.sql, applied after 0004):
 * book → contract shown at once → customer accepts → pay. No Admin step.
 * Real database (PGlite), real roles and RLS. Fictional people only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestDb,
  type TestUser,
  SELF_ACCEPT_MIGRATION,
  accept,
  adminCreate,
  allCarIds,
  bookingRow,
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
let alice: TestUser;
let bob: TestUser;
let cars: string[];
let slot = 0;
const book = (who: TestUser) =>
  createBooking(db, who, cars[slot % cars.length]!, 3 + 4 * Math.floor(slot++ / cars.length), 2);

const contractFor = async (bookingId: string) => {
  const [c] = await db.sql<Record<string, unknown>>(
    "select * from public.contracts where booking_id = $1",
    [bookingId],
  );
  return c;
};

beforeAll(async () => {
  db = await createTestDb({ after: [SELF_ACCEPT_MIGRATION] });
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ", phone: "000-000-0001" });
  bob = await createUser(db, { name: "ทดสอบ ลูกค้าบี" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("customer self-accept", () => {
  it("S01 a new booking gets a contract the customer can read straight away", async () => {
    const b = await book(alice);
    const c = await contractFor(b.id);
    expect(c).toMatchObject({ status: "pending_customer", current_version: 1, sent_version: 1 });
    expect(String(c!["terms"])).toContain("ทดสอบ ลูกค้าเอ");
    expect(String(c!["terms"])).toContain("10:00");

    const seen = await db
      .as(alice)
      .sql("select id from public.contracts where booking_id = $1", [b.id]);
    expect(seen).toHaveLength(1);
    const versions = await db
      .as(alice)
      .sql("select version from public.contract_versions where contract_id = $1", [c!["id"]]);
    expect(versions).toHaveLength(1);
    const notBob = await db
      .as(bob)
      .sql("select id from public.contracts where booking_id = $1", [b.id]);
    expect(notBob).toHaveLength(0);
  });

  it("S02 accept → approved with a 15-minute payment window, then pay → confirmed", async () => {
    const b = await book(alice);
    const c = await contractFor(b.id);
    await accept(db, alice, String(c!["id"]), 1);

    const after = await contractFor(b.id);
    expect(after!["status"]).toBe("approved");
    const hold = new Date((await bookingRow(db, b.id))["hold_expires_at"] as string).getTime();
    expect(hold - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(hold - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 5_000);

    await pay(db, alice, b.id, "card", "4242");
    expect((await bookingRow(db, b.id))["status"]).toBe("confirmed");
    expect((await contractFor(b.id))!["status"]).toBe("paid");
    const [p] = await db.sql<{ amount: string }>(
      "select amount::text from public.payments where booking_id = $1",
      [b.id],
    );
    expect(Number(p!.amount)).toBe(Number(b.total_amount));
  });

  it("S03 cannot pay before accepting", async () => {
    const b = await book(alice);
    await expect(pay(db, alice, b.id, "qr")).rejects.toThrow(/ยอมรับสัญญา/);
  });

  it("S04 another customer cannot accept or pay", async () => {
    const b = await book(alice);
    const c = await contractFor(b.id);
    await expect(accept(db, bob, String(c!["id"]), 1)).rejects.toThrow(/ไม่พบสัญญา/);
    await accept(db, alice, String(c!["id"]), 1);
    await expect(pay(db, bob, b.id, "qr")).rejects.toThrow(/ไม่พบการจอง/);
  });

  it("S05 an expired hold blocks accepting", async () => {
    const b = await book(alice);
    const c = await contractFor(b.id);
    await expireHold(db, b.id);
    await expect(accept(db, alice, String(c!["id"]), 1)).rejects.toThrow(/หมดเวลา/);
  });

  it("S06 customer_prepare_contract is idempotent and owner-only", async () => {
    const b = await book(alice);
    const c = await contractFor(b.id);
    const [r] = await db
      .as(alice)
      .sql<{ id: string }>("select public.customer_prepare_contract($1) as id", [b.id]);
    expect(r!.id).toBe(c!["id"]);
    await expect(
      db.as(bob).sql("select public.customer_prepare_contract($1)", [b.id]),
    ).rejects.toThrow(/ไม่พบการจอง/);
    await expect(
      db.as(alice).sql("select public.start_customer_contract(b) from public.bookings b limit 1"),
    ).rejects.toThrow(/permission denied/);
  });

  it("S07 a pending booking without a contract (made before the change) gets one on request", async () => {
    const b = await book(alice);
    // Simulate a legacy booking: remove the auto-created contract as superuser
    await db.exec(`
      alter table public.contract_events disable trigger user;
      alter table public.contract_versions disable trigger user;
      delete from public.contract_events where booking_id = '${b.id}';
      delete from public.contracts where booking_id = '${b.id}';
      alter table public.contract_events enable trigger user;
      alter table public.contract_versions enable trigger user;`);
    expect(await contractFor(b.id)).toBeUndefined();
    await db.as(alice).sql("select public.customer_prepare_contract($1)", [b.id]);
    expect((await contractFor(b.id))!["status"]).toBe("pending_customer");
  });
});

describe("migrating contracts that were waiting for an Admin", () => {
  it("S08 pending_admin_review becomes approved with a fresh payment window", async () => {
    const legacy = await createTestDb();
    try {
      const admin = await createAdmin(legacy);
      const carol = await createUser(legacy, { name: "ทดสอบ ลูกค้าซี" });
      const [car] = await allCarIds(legacy);
      const b = await createBooking(legacy, carol, car!);
      const id = await adminCreate(legacy, admin, b.id, terms(b));
      await send(legacy, admin, id);
      await accept(legacy, carol, id, 1);
      await legacy.exec((await import("node:fs")).readFileSync(SELF_ACCEPT_MIGRATION, "utf8"));
      const [c] = await legacy.sql<{ status: string }>(
        "select status from public.contracts where id = $1",
        [id],
      );
      expect(c!.status).toBe("approved");
      await pay(legacy, carol, b.id, "qr");
      expect((await bookingRow(legacy, b.id))["status"]).toBe("confirmed");
    } finally {
      await legacy.close();
    }
  }, 60000);
});
