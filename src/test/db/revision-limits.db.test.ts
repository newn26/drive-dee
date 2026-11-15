// @vitest-environment node
/**
 * Contract revision rules (docs/database/revision-limits.sql) on the live stack (0000-0007):
 * at most 2 customer change requests per contract, and the requested name reaches the
 * profile only when an admin applies it. Real database (PGlite). Fictional people only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestDb,
  type TestUser,
  adminCreate,
  adminUpdate,
  allCarIds,
  createAdmin,
  createBooking,
  createTestDb,
  createUser,
  send,
  terms,
} from "./harness";
import { MAX_CUSTOMER_REVISIONS, revisionReasonText } from "@/lib/contract-workflow";

const SQL = readFileSync(
  path.resolve(__dirname, "../../../docs/database/revision-limits.sql"),
  "utf8",
);

let db: TestDb;
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let cars: string[];
let slot = 0;

const reason = (name: string) =>
  revisionReasonText({ customerName: name, pickupTime: "09:00", returnTime: "18:00" });
const request = (who: TestUser, contractId: string, version: number, name: string) =>
  db
    .as(who)
    .sql("select public.customer_request_revision($1, $2, $3)", [
      contractId,
      version,
      reason(name),
    ]);
const applyName = (who: TestUser, contractId: string, name: string) =>
  db.as(who).sql("select public.admin_apply_requested_name($1, $2)", [contractId, name]);
const profileName = async (u: TestUser) =>
  (
    await db.sql<{ n: string }>("select full_name as n from public.profiles where id = $1", [u.id])
  )[0]!.n;

async function sentDraft(who: TestUser = alice) {
  const booking = await createBooking(db, who, cars[slot++]!, 3, 2);
  const contractId = await adminCreate(db, admin, booking.id, terms(booking));
  await send(db, admin, contractId);
  return { booking, contractId };
}

/** Admin answers a request with a new version and sends it; returns the new version. */
async function resend(contractId: string, booking: Awaited<ReturnType<typeof createBooking>>) {
  const v = await adminUpdate(
    db,
    admin,
    contractId,
    terms(booking, { pickup: `${booking.start_date} 09:00:00+07` }),
  );
  await send(db, admin, contractId);
  return v;
}

beforeAll(async () => {
  db = await createTestDb({ applyLater: true });
  await db.exec(SQL);
  await db.exec(SQL); // re-runnable
  admin = await createAdmin(db);
  alice = await createUser(db, { name: "ทดสอบ ลูกค้าเอ" });
  bob = await createUser(db, { name: "ทดสอบ ลูกค้าบี" });
  cars = await allCarIds(db);
}, 60000);
afterAll(() => db.close());

describe("revision limit", () => {
  it("the UI limit matches the database", async () => {
    const [r] = await db.sql<{ n: number }>("select public.max_customer_revisions() as n");
    expect(Number(r!.n)).toBe(MAX_CUSTOMER_REVISIONS);
  });

  it(`a customer can ask for changes ${MAX_CUSTOMER_REVISIONS} times, not more`, async () => {
    const { booking, contractId } = await sentDraft();
    let v = 1;
    for (let i = 0; i < MAX_CUSTOMER_REVISIONS; i++) {
      await request(alice, contractId, v, "ทดสอบ ลูกค้าเอ");
      v = await resend(contractId, booking);
    }
    await expect(request(alice, contractId, v, "ทดสอบ ลูกค้าเอ")).rejects.toThrow(
      /ขอแก้ไขสัญญาได้สูงสุด 2 ครั้ง/,
    );
    // the contract is still waiting for the customer: they can confirm or cancel
    const [c] = await db.sql<{ status: string }>(
      "select status from public.contracts where id = $1",
      [contractId],
    );
    expect(c!.status).toBe("pending_customer");
  });
});

describe("requested name", () => {
  it("asking does not change the profile; the admin applies exactly the requested name", async () => {
    const { contractId } = await sentDraft();
    await request(alice, contractId, 1, "ทดสอบ ชื่อใหม่");
    expect(await profileName(alice)).toBe("ทดสอบ ลูกค้าเอ");

    await expect(applyName(admin, contractId, "ชื่ออื่น ที่ไม่ได้ขอ")).rejects.toThrow(
      /ไม่ตรงกับที่ลูกค้าขอ/,
    );
    await applyName(admin, contractId, "ทดสอบ ชื่อใหม่");
    expect(await profileName(alice)).toBe("ทดสอบ ชื่อใหม่");
    const ev = await db.sql<{ note: string }>(
      "select note from public.contract_events where contract_id = $1 and action = 'edited'",
      [contractId],
    );
    expect(ev.map((e) => e.note)).toContain("เปลี่ยนชื่อผู้เช่าตามคำขอของลูกค้า: ทดสอบ ชื่อใหม่");
  });

  it("customers and admins without contracts_manage cannot apply a name; nothing to apply without a request", async () => {
    const { contractId } = await sentDraft(bob);
    await expect(applyName(admin, contractId, "ทดสอบ ลูกค้าบี")).rejects.toThrow(/ไม่มีคำขอแก้ไข/);
    await request(bob, contractId, 1, "ทดสอบ บีใหม่");
    await expect(applyName(bob, contractId, "ทดสอบ บีใหม่")).rejects.toThrow(/ไม่มีสิทธิ์/);
    const viewer = await createAdmin(db, { permissions: ["bookings_manage"] });
    await expect(applyName(viewer, contractId, "ทดสอบ บีใหม่")).rejects.toThrow(/ไม่มีสิทธิ์/);
    expect(await profileName(bob)).toBe("ทดสอบ ลูกค้าบี");
  });
});
